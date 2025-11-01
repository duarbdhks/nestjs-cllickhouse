import { ProductEntity } from '../../database/entities';

export class ProductResponseDto {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  static from(entity: ProductEntity): ProductResponseDto {
    const dto = new ProductResponseDto();
    dto.id = entity.id;
    dto.name = entity.name;
    dto.description = entity.description;
    dto.price = Number(entity.price); // Ensure decimal is converted to number
    dto.category = entity.category;
    dto.imageUrl = entity.imageUrl;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }

  static fromArray(entities: ProductEntity[]): ProductResponseDto[] {
    return entities.map(entity => ProductResponseDto.from(entity));
  }
}
