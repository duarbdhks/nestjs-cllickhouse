import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Param, Post } from '@nestjs/common';
import { CreateOrderDto, OrderResponseDto } from './dto';
import { OrderService } from './order.service';

@Controller('orders')
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(private readonly orderService: OrderService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(@Body() createOrderDto: CreateOrderDto): Promise<OrderResponseDto> {
    this.logger.log(`Creating order for user: ${createOrderDto.userId}, amount: ${createOrderDto.totalAmount}`);

    const order = await this.orderService.createOrder(createOrderDto);

    this.logger.log(`Order created successfully: ${order.id}`);

    return order;
  }

  @Get(':id')
  async getOrder(@Param('id') id: string): Promise<OrderResponseDto | null> {
    const order = await this.orderService.findOne(id);
    return order ? OrderResponseDto.from(order) : null;
  }

  @Get('user/:userId')
  async getUserOrders(@Param('userId') userId: string): Promise<OrderResponseDto[]> {
    const orders = await this.orderService.findByUserId(userId);
    return orders.map(order => OrderResponseDto.from(order));
  }
}
