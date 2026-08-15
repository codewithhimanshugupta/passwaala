import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

/**
 * ReviewsService — shop ratings (plan → Fast-Follows: ratings & review flow).
 *
 * HARD RULES:
 *  - Verified purchase only: the order must belong to the customer AND be
 *    DELIVERED. One review per order (unique on orderId).
 *  - Writing a review updates the shop's denormalized avgRating + ratingCount
 *    (so discovery sort stays a fast indexed read, not a live aggregate).
 */
@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(customerId: string, dto: CreateReviewDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, customerId, deletedAt: null },
      select: { id: true, shopId: true, status: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('You can only review a delivered order');
    }

    const existing = await this.prisma.review.findFirst({
      where: { orderId: dto.orderId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('This order has already been reviewed');
    }

    // Create the review + recompute the shop's denormalized rating atomically.
    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          shopId: order.shopId,
          customerId,
          orderId: order.id,
          rating: dto.rating,
          comment: dto.comment,
        },
      });

      const agg = await tx.review.aggregate({
        where: { shopId: order.shopId, deletedAt: null },
        _avg: { rating: true },
        _count: { _all: true },
      });
      await tx.shop.update({
        where: { id: order.shopId },
        data: {
          avgRating: agg._avg.rating ?? 0,
          ratingCount: agg._count._all,
        },
      });
      return created;
    });

    return review;
  }

  /** Public: list a shop's reviews (newest first) with reviewer name + tenure. */
  async listForShop(shopId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { shopId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        customer: { select: { name: true, createdAt: true } },
      },
    });
    // Surface reviewer display name (first name, or "NearBaz Customer") and how
    // long they've been on the platform — never the phone/PII.
    return reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      reviewerName: r.customer?.name?.split(' ')[0] ?? 'NearBaz Customer',
      memberSince: r.customer?.createdAt ?? null,
    }));
  }
}
