import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, ValidateNested } from 'class-validator';

export class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @IsString()
  @IsOptional()
  shippingAddress?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  @IsOptional()
  items?: OrderItemDto[];
}
