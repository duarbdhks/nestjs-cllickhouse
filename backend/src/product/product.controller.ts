import { Controller, Get, Param } from '@nestjs/common';
import { ProductResponseDto } from './dto';
import { ProductService } from './product.service';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  /**
   * GET /api/products
   * Get all active products
   */
  @Get()
  async findAll(): Promise<ProductResponseDto[]> {
    const products = await this.productService.findAll();
    return ProductResponseDto.fromArray(products);
  }

  /**
   * GET /api/products/:id
   * Get a single product by ID
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ProductResponseDto> {
    const product = await this.productService.findOne(id);
    return ProductResponseDto.from(product);
  }

  /**
   * GET /api/products/category/:category
   * Get products by category
   */
  @Get('category/:category')
  async findByCategory(@Param('category') category: string): Promise<ProductResponseDto[]> {
    const products = await this.productService.findByCategory(category);
    return ProductResponseDto.fromArray(products);
  }
}
