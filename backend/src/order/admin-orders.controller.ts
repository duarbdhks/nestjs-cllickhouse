import { BadRequestException, Controller, Delete, Headers, HttpCode, HttpStatus, Logger, Param } from '@nestjs/common';
import { OrderService } from './order.service';

@Controller('admin/orders')
export class AdminOrdersController {
  private readonly logger = new Logger(AdminOrdersController.name);

  constructor(private readonly orderService: OrderService) {}

  /**
   * Soft delete order (Admin only)
   * DELETE /admin/orders/:id
   *
   * Headers:
   * - X-Admin-Id: Admin user ID (required for audit trail)
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOrder(@Param('id') orderId: string, @Headers('x-admin-id') adminId: string): Promise<void> {
    if (!adminId) {
      throw new BadRequestException('X-Admin-Id header is required');
    }

    this.logger.log(`Admin ${adminId} is deleting order ${orderId}`);

    await this.orderService.deleteOrder(orderId, adminId);

    this.logger.log(`Order ${orderId} successfully deleted by admin ${adminId}`);
  }
}
