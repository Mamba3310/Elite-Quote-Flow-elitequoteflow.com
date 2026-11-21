-- Restore admin portal access for the Cloudflare Worker service role.
-- Run this in the SQL Editor of the Elite Quote Flow Supabase project.
grant select, insert, update, delete on table
  public.customer_reviews,
  public.quote_bookings,
  public.public_booking_requests,
  public.recurring_service_plans,
  public.quotes
to service_role;
