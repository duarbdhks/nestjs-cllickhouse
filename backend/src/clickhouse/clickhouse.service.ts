import { ClickHouseClient, createClient } from '@clickhouse/client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ClickHouseService implements OnModuleInit {
  private readonly logger = new Logger(ClickHouseService.name);
  private client: ClickHouseClient;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get('CLICKHOUSE_HOST', 'localhost');
    const port = this.configService.get('CLICKHOUSE_PORT', '8123');
    const username = this.configService.get('CLICKHOUSE_USERNAME', 'admin');
    const password = this.configService.get('CLICKHOUSE_PASSWORD', 'test123');
    const database = this.configService.get('CLICKHOUSE_DATABASE', 'analytics');

    // Construct full URL
    const url = `http://${host}:${port}`;

    this.client = createClient({
      url,
      username,
      password,
      database,
    });

    this.logger.log(`ClickHouse client initialized: ${url}/${database}`);
  }

  /**
   * Get daily sales summary
   */
  async getDailySales(startDate?: string, endDate?: string): Promise<any[]> {
    let query = 'SELECT * FROM analytics.daily_sales_mv';
    const params: Record<string, string> = {};

    if (startDate && endDate) {
      query += ' WHERE order_date BETWEEN {startDate:Date} AND {endDate:Date}';
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (startDate) {
      query += ' WHERE order_date >= {startDate:Date}';
      params.startDate = startDate;
    } else if (endDate) {
      query += ' WHERE order_date <= {endDate:Date}';
      params.endDate = endDate;
    }

    query += ' ORDER BY order_date DESC';

    const resultSet = await this.client.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    });

    return await resultSet.json();
  }

  /**
   * Get hourly sales summary
   */
  async getHourlySales(startDate?: string, endDate?: string, limit = 24): Promise<any[]> {
    let query = 'SELECT * FROM analytics.hourly_sales_mv';
    const params: Record<string, string | number> = {};

    if (startDate && endDate) {
      query += ' WHERE order_hour BETWEEN {startDate:DateTime} AND {endDate:DateTime}';
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (startDate) {
      query += ' WHERE order_hour >= {startDate:DateTime}';
      params.startDate = startDate;
    } else if (endDate) {
      query += ' WHERE order_hour <= {endDate:DateTime}';
      params.endDate = endDate;
    }

    query += ' ORDER BY order_hour DESC LIMIT {limit:UInt32}';
    params.limit = limit;

    const resultSet = await this.client.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    });

    return await resultSet.json();
  }

  /**
   * Get order status distribution
   */
  async getOrderStatusDistribution(startDate?: string, endDate?: string): Promise<any[]> {
    let query = 'SELECT * FROM analytics.order_status_mv';
    const params: Record<string, string> = {};

    if (startDate && endDate) {
      query += ' WHERE order_date BETWEEN {startDate:Date} AND {endDate:Date}';
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (startDate) {
      query += ' WHERE order_date >= {startDate:Date}';
      params.startDate = startDate;
    } else if (endDate) {
      query += ' WHERE order_date <= {endDate:Date}';
      params.endDate = endDate;
    }

    query += ' ORDER BY order_date DESC, status ASC';

    const resultSet = await this.client.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    });

    return await resultSet.json();
  }

  /**
   * Get overall statistics
   */
  async getOverallStats(): Promise<any> {
    const query = `
      SELECT count()           as total_orders,
             sum(total_amount) as total_revenue,
             avg(total_amount) as avg_order_value,
             uniq(user_id)     as unique_customers
      FROM analytics.orders_analytics FINAL
      WHERE is_deleted = 0
    `;

    const resultSet = await this.client.query({
      query,
      format: 'JSONEachRow',
    });

    const result = await resultSet.json();
    return result[0];
  }

  /**
   * Health check query
   */
  async ping(): Promise<boolean> {
    try {
      const resultSet = await this.client.query({
        query: 'SELECT 1',
        format: 'JSONEachRow',
      });
      await resultSet.json();
      return true;
    } catch (error) {
      this.logger.error('ClickHouse ping failed', error);
      return false;
    }
  }
}
