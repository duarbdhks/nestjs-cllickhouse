import { Controller, Get, Query } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { DailySalesDto, HourlySalesDto, OrderStatusDto, OverallStatsDto } from '../clickhouse/dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly clickHouseService: ClickHouseService) {}

  /**
   * GET /api/analytics/daily-sales
   * 일별 매출 집계 조회
   * Query params: startDate, endDate (optional, format: YYYY-MM-DD)
   */
  @Get('daily-sales')
  async getDailySales(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string): Promise<DailySalesDto[]> {
    return this.clickHouseService.getDailySales(startDate, endDate);
  }

  /**
   * GET /api/analytics/hourly-sales
   * 시간별 주문 집계 조회
   * Query params: startDate, endDate, limit (optional)
   */
  @Get('hourly-sales')
  async getHourlySales(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: number,
  ): Promise<HourlySalesDto[]> {
    return this.clickHouseService.getHourlySales(startDate, endDate, limit || 24);
  }

  /**
   * GET /api/analytics/order-status
   * 주문 상태별 분포 조회
   * Query params: startDate, endDate (optional)
   */
  @Get('order-status')
  async getOrderStatus(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string): Promise<OrderStatusDto[]> {
    return this.clickHouseService.getOrderStatusDistribution(startDate, endDate);
  }

  /**
   * GET /api/analytics/stats
   * 전체 통계 조회
   */
  @Get('stats')
  async getOverallStats(): Promise<OverallStatsDto> {
    return this.clickHouseService.getOverallStats();
  }

  /**
   * GET /api/analytics/health
   * ClickHouse 연결 상태 확인
   */
  @Get('health')
  async healthCheck(): Promise<{ status: string; clickhouse: boolean }> {
    const isHealthy = await this.clickHouseService.ping();
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      clickhouse: isHealthy,
    };
  }
}
