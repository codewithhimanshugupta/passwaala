import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

/**
 * AddressesService — a customer's saved delivery addresses (plan → Cart &
 * Checkout: address selection). Scoped to the authenticated user; the geo point
 * is stored for serviceability + future rider routing.
 */
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  /** List the caller's saved addresses (newest first). */
  listMine(userId: string) {
    return this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Save a new address for the caller. */
  async create(userId: string, dto: CreateAddressDto) {
    const address = await this.prisma.address.create({
      data: {
        userId,
        line: dto.line,
        landmark: dto.landmark,
        latitude: dto.latitude,
        longitude: dto.longitude,
        label: dto.label,
      },
    });
    // Maintain the PostGIS geog point (out-of-band Unsupported column).
    await this.prisma.$executeRawUnsafe(
      `UPDATE "Address" SET geog = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3`,
      dto.longitude,
      dto.latitude,
      address.id,
    );
    return address;
  }

  /** Update one of the caller's addresses (ownership-checked). */
  async update(userId: string, id: string, dto: UpdateAddressDto) {
    const existing = await this.prisma.address.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true, latitude: true, longitude: true },
    });
    if (!existing) {
      throw new NotFoundException('Address not found');
    }
    const updated = await this.prisma.address.update({
      where: { id },
      data: {
        line: dto.line,
        landmark: dto.landmark,
        latitude: dto.latitude,
        longitude: dto.longitude,
        label: dto.label,
      },
    });
    // Re-sync geog if coordinates changed.
    if (dto.latitude != null || dto.longitude != null) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "Address" SET geog = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3`,
        updated.longitude,
        updated.latitude,
        id,
      );
    }
    return updated;
  }

  /** Soft-delete one of the caller's addresses (ownership-checked). */
  async remove(userId: string, id: string) {
    const existing = await this.prisma.address.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Address not found');
    }
    await this.prisma.address.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }
}
