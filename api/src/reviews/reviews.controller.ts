import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

/**
 * ReviewsController — any authenticated user writes one review per delivered
 * order of theirs (verified purchase, enforced in the service); anyone can read
 * a shop's reviews.
 */
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Write a review for one of the caller's delivered orders (verified purchase). */
  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() dto: CreateReviewDto) {
    return this.reviews.create(user.sub, dto);
  }

  /** Public: a shop's reviews. */
  @Public()
  @Get('shop/:shopId')
  listForShop(@Param('shopId') shopId: string) {
    return this.reviews.listForShop(shopId);
  }
}
