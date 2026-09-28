-- ============================================================================
-- Public auctions v2 — phase 2: payment state machine (2026-09-29). Money.
-- Spec: docs/AUCTIONS_SPEC.md §3, §5.
-- ============================================================================
--   ended / payment_failed ──claim──▶ charging ──paid──▶ paid ──handoff──▶ handed_off
--                                        └──failure──▶ payment_failed
--   paid ──refund──▶ refunded (stock returned);  handed_off ──refund──▶ refunded (fish gone)
--
-- api/stripe.js drives it (service role): claim a lot, charge the winner's saved
-- card off-session into the platform balance (held, no transfer_data), then mark
-- it paid. The payout happens at pickup through the existing guest-handoff flow.
--
-- The sweep is pinged by pg_cron via pg_net only when something is due, using a
-- secret kept in Supabase Vault (name 'auction_sweep_secret').
-- ============================================================================

begin;

-- ── 0. Settlement rows can record an auction charge ────────────────────────
alter table public.fiat_settlements drop constraint if exists fiat_settlements_purchase_type_check;
alter table public.fiat_settlements
  add constraint fiat_settlements_purchase_type_check
  check (purchase_type in ('specimen', 'shipping', 'batch', 'multi', 'pickup', 'auction'));

-- ── 1. Claim a lot for charging (single winner of the race) ────────────────
-- Claimable: 'ended' (fresh close), 'payment_failed' (winner retries / updated
-- card), or 'charging' stuck for 10+ minutes (a crashed attempt). Returns null
-- when not claimable, so two sweeps can't both charge.
create or replace function public.claim_auction_lot_for_charge(p_lot uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots; a public.auctions;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if not found then return null; end if;
  if not (
       l.status in ('ended', 'payment_failed')
       or (l.status = 'charging' and l.updated_at < now() - interval '10 minutes')
     ) then
    return null;
  end if;
  if l.payment_deadline is not null and l.payment_deadline < now() then
    return null;  -- the close job will forfeit it
  end if;

  update public.auction_lots
     set status = 'charging', charge_attempts = charge_attempts + 1
   where id = l.id;
  select * into a from public.auctions where id = l.auction_id;

  return jsonb_build_object(
    'lotId', l.id,
    'attempt', l.charge_attempts + 1,
    'title', l.title,
    'sellerWallet', l.seller_wallet,
    'winnerWallet', l.winner_wallet,
    'hammerCents', l.hammer_cents,
    'quantity', l.quantity,
    'source', l.source,
    'listingId', l.listing_id,
    'clubSplitPercent', l.club_split_percent,
    'hostType', a.host_type,
    'schoolId', a.school_id,
    'pickupLocation', a.pickup_location,
    'paymentDeadline', l.payment_deadline
  );
end;
$$;

create or replace function public.mark_auction_lot_paid(
  p_lot uuid, p_payment_intent text, p_fee_percent numeric, p_order_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if not found then raise exception 'lot not found' using errcode = 'no_data_found'; end if;
  -- Idempotent on the same PaymentIntent (a retried request).
  if l.status in ('paid', 'handed_off') and l.payment_intent = p_payment_intent then
    return jsonb_build_object('lotId', l.id, 'status', l.status, 'replay', true);
  end if;
  if l.status <> 'charging' then
    raise exception 'lot % is %, not charging', p_lot, l.status using errcode = 'check_violation';
  end if;
  update public.auction_lots
     set status = 'paid', paid_at = now(), payment_intent = p_payment_intent,
         fee_percent = p_fee_percent, order_id = p_order_id, last_charge_error = null
   where id = l.id;
  return jsonb_build_object('lotId', l.id, 'status', 'paid');
end;
$$;

create or replace function public.record_auction_lot_charge_failure(p_lot uuid, p_error text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if not found then raise exception 'lot not found' using errcode = 'no_data_found'; end if;
  if l.status <> 'charging' then
    raise exception 'lot % is %, not charging', p_lot, l.status using errcode = 'check_violation';
  end if;
  update public.auction_lots
     set status = 'payment_failed', last_charge_error = left(coalesce(p_error, 'Card was declined'), 500)
   where id = l.id;
  return jsonb_build_object('lotId', l.id, 'status', 'payment_failed', 'deadline', l.payment_deadline);
end;
$$;

create or replace function public.mark_auction_lot_handed_off(p_lot uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if not found then raise exception 'lot not found' using errcode = 'no_data_found'; end if;
  if l.status = 'handed_off' then return jsonb_build_object('lotId', l.id, 'status', 'handed_off', 'replay', true); end if;
  if l.status <> 'paid' then
    raise exception 'lot % is %, not paid', p_lot, l.status using errcode = 'check_violation';
  end if;
  update public.auction_lots set status = 'handed_off', handed_off_at = now() where id = l.id;
  return jsonb_build_object('lotId', l.id, 'status', 'handed_off');
end;
$$;

-- A refund from the Stripe dashboard. Before pickup the fish is still with the
-- seller, so stock goes back; after pickup it doesn't.
create or replace function public.mark_auction_lot_refunded(p_payment_intent text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots; v_restocked boolean := false;
begin
  select * into l from public.auction_lots where payment_intent = p_payment_intent for update;
  if not found then return null; end if;
  if l.status = 'refunded' then return jsonb_build_object('lotId', l.id, 'status', 'refunded', 'replay', true); end if;
  if l.status not in ('paid', 'handed_off') then
    raise exception 'lot % is %, not paid', l.id, l.status using errcode = 'check_violation';
  end if;
  if l.status = 'paid' then
    perform public.auction_lot_return_stock(l.id);
    v_restocked := true;
  end if;
  update public.auction_lots set status = 'refunded' where id = l.id;
  return jsonb_build_object('lotId', l.id, 'status', 'refunded', 'restocked', v_restocked);
end;
$$;

-- ── 2. The sweep's work list ───────────────────────────────────────────────
create or replace function public.auction_lots_due_for_charge(p_limit integer default 20)
returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.auction_lots
   where (status = 'ended' or (status = 'charging' and updated_at < now() - interval '10 minutes'))
     and (payment_deadline is null or payment_deadline > now())
   order by closed_at nulls first
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- ── 3. Ping the charge sweep, only when there's something to charge ────────
create or replace function public.auction_ping_charge_sweep()
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_secret text; v_request bigint;
begin
  if not exists (select 1 from public.auction_lots_due_for_charge(1)) then
    return null;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'auction_sweep_secret';
  if v_secret is null then
    raise warning 'auction_sweep_secret is not set in Vault; skipping the charge sweep';
    return null;
  end if;
  select net.http_post(
    url := 'https://aquacellum.com/api/stripe?action=auction-sweep',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into v_request;
  return v_request;
end;
$$;

-- ── 4. Grants: server only ─────────────────────────────────────────────────
revoke execute on function public.claim_auction_lot_for_charge(uuid)                  from public, anon, authenticated;
revoke execute on function public.mark_auction_lot_paid(uuid, text, numeric, uuid)    from public, anon, authenticated;
revoke execute on function public.record_auction_lot_charge_failure(uuid, text)       from public, anon, authenticated;
revoke execute on function public.mark_auction_lot_handed_off(uuid)                   from public, anon, authenticated;
revoke execute on function public.mark_auction_lot_refunded(text)                     from public, anon, authenticated;
revoke execute on function public.auction_lots_due_for_charge(integer)                from public, anon, authenticated;
revoke execute on function public.auction_ping_charge_sweep()                         from public, anon, authenticated;

grant execute on function public.claim_auction_lot_for_charge(uuid)                  to service_role;
grant execute on function public.mark_auction_lot_paid(uuid, text, numeric, uuid)    to service_role;
grant execute on function public.record_auction_lot_charge_failure(uuid, text)       to service_role;
grant execute on function public.mark_auction_lot_handed_off(uuid)                   to service_role;
grant execute on function public.mark_auction_lot_refunded(text)                     to service_role;
grant execute on function public.auction_lots_due_for_charge(integer)                to service_role;

-- ── 5. Cron: close, then ping the charge sweep if anything is due ──────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'auction-close-ended-lots') then
    perform cron.unschedule('auction-close-ended-lots');
  end if;
  perform cron.schedule('auction-close-ended-lots', '* * * * *',
    'select public.close_ended_auction_lots(); select public.auction_ping_charge_sweep();');
end;
$$;

do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('claim_auction_lot_for_charge', 'mark_auction_lot_paid', 'record_auction_lot_charge_failure',
                      'mark_auction_lot_handed_off', 'mark_auction_lot_refunded', 'auction_lots_due_for_charge',
                      'auction_ping_charge_sweep')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then raise exception 'browser roles can execute: %', v_bad; end if;
end;
$$;

commit;
