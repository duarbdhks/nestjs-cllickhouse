import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ProductEntity } from '../database/entities';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
  ) {}

  /**
   * Get all active products (not deleted)
   */
  async findAll(): Promise<ProductEntity[]> {
    return this.productRepository.find({
      where: {
        isActive: true,
        deletedAt: IsNull(),
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  /**
   * Get a single product by ID
   */
  async findOne(id: string): Promise<ProductEntity> {
    const product = await this.productRepository.findOne({
      where: {
        id,
        deletedAt: IsNull(),
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  /**
   * Get products by category
   */
  async findByCategory(category: string): Promise<ProductEntity[]> {
    return this.productRepository.find({
      where: {
        category,
        isActive: true,
        deletedAt: IsNull(),
      },
      order: {
        name: 'ASC',
      },
    });
  }
}
