import { IsEnum, IsOptional } from 'class-validator';

/**
 * Time window for the admin dashboard's Order Status widget. The counts are
 * computed over orders created since the start of the selected period
 * (server-local time). Defaults to Today when omitted.
 */
export enum DashboardPeriod {
  Today = 'Today',
  Weekly = 'Weekly',
  Monthly = 'Monthly',
  Yearly = 'Yearly',
}

/** Query params for GET /admin/dashboard — the Order Status period selector. */
export class DashboardQuery {
  @IsOptional()
  @IsEnum(DashboardPeriod)
  period?: DashboardPeriod;
}
