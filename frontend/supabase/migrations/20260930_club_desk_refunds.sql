-- Club auction night desk: payout tracking, refunds and disputes — 2026-09-30.
-- Follows 20260930_club_desk_serialize.sql. Money path (Tier A).
-- ============================================================================
-- A desk card payment pays the club straight away (separate charge + transfer).
-- Until now the transfer wasn't recorded, so a failed payout was only a log
-- line, and a refund or dispute left the club's payout in place (we covered it).
--
-- Now each desk payment records:
--   * the transfer to the club (id + amount), or why it failed;
--   * how much of that payout has been reversed, and why a reversal failed;
--   * refunds (cumulative cents) and disputes.
-- A full refund marks the payment and its lots 'refunded', so they drop out of
-- the consignor report. The fish were handed over, so nothing is restocked.
-- ============================================================================

begin;

alter table public.auction_desk_payments add column if not exists payout_cents       integer check (payout_cents is null or payout_cents >= 0);
alter table public.auction_desk_payments add column if not exists stripe_transfer_id text;
alter table public.auction_desk_payments add column if not exists transfer_error     text;
alter table public.auction_desk_payments add column if not exists reversed_cents     integer not null default 0 check (reversed_cents >= 0);
alter table public.auction_desk_payments add column if not exists reversal_error     text;
alter table public.auction_desk_payments add column if not exists refunded_cents     integer not null default 0 check (refunded_cents >= 0);
alter table public.auction_desk_payments add column if not exists refunded_at        timestamptz;
alter table public.auction_desk_payments add column if not exists disputed_at        timestamptz;

alter table public.auction_desk_payments drop constraint if exists auction_desk_payments_status_check;
alter table public.auction_desk_payments add constraint auction_desk_payments_status_check
  check (status in ('pending', 'paid', 'failed', 'void', 'refunded'));

-- Stripe refunded some or all of a paid desk payment. Returns the payment (for
-- the payout reversal), or null when the PaymentIntent isn't a paid desk payment
-- (e.g. our own refund of a superseded QR, whose payment is void or failed).
create or replace function public.desk_record_refund(p_payment_intent text, p_refunded_cents integer, p_full boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.auction_desk_payments;
begin
  select * into d from public.auction_desk_payments
   where stripe_payment_intent = p_payment_intent and status in ('paid', 'refunded')
   for update;
  if not found then return null; end if;
  update public.auction_desk_payments
     set refunded_cents = greatest(refunded_cents, least(total_cents, greatest(0, coalesce(p_refunded_cents, 0)))),
         refunded_at = coalesce(refunded_at, now()),
         status = case when coalesce(p_full, false) then 'refunded' else status end
   where id = d.id
  returning * into d;
  if coalesce(p_full, false) then
    update public.auction_lots set status = 'refunded'
     where desk_payment_id = d.id and status = 'handed_off';
  end if;
  return jsonb_build_object('id', d.id, 'status', d.status, 'totalCents', d.total_cents,
                            'refundedCents', d.refunded_cents, 'payoutCents', d.payout_cents,
                            'transferId', d.stripe_transfer_id, 'reversedCents', d.reversed_cents);
end;
$$;

-- A dispute opened on a desk payment. Same return shape as desk_record_refund.
create or replace function public.desk_record_dispute(p_payment_intent text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.auction_desk_payments;
begin
  update public.auction_desk_payments
     set disputed_at = coalesce(disputed_at, now())
   where stripe_payment_intent = p_payment_intent and status in ('paid', 'refunded')
  returning * into d;
  if not found then return null; end if;
  return jsonb_build_object('id', d.id, 'status', d.status, 'totalCents', d.total_cents,
                            'refundedCents', d.refunded_cents, 'payoutCents', d.payout_cents,
                            'transferId', d.stripe_transfer_id, 'reversedCents', d.reversed_cents);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['desk_record_refund(text, integer, boolean)', 'desk_record_dispute(text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  if has_function_privilege('anon', 'public.desk_record_refund(text, integer, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.desk_record_dispute(text)', 'execute') then
    raise exception 'browser roles can execute desk refund functions';
  end if;
  if has_table_privilege('anon', 'public.auction_desk_payments', 'select') then
    raise exception 'browser roles can read desk payments';
  end if;
end;
$$;

commit;
