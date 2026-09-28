-- Club auction night desk: one payment at a time per bidder — 2026-09-30.
-- Follows 20260929_club_auction_night.sql. Money path (Tier A).
-- ============================================================================
-- desk_begin_card_payment and desk_record_cash read a bidder's unpaid lots and
-- then reserve them, with no lock in between. Two taps at once (a double tap,
-- or two organizers at the desk) could both reserve the same lots:
--   * two card payments: the lots end up on the second, but the first QR can
--     still be paid, marked paid with no lots, and paid out to the club;
--   * cash + card: the cash lots are handed off, then also put on a card payment.
-- An undo racing a card start could also leave an undone lot in the total.
--
-- Fix: lock the bidder row first (serializes every desk action for that bidder),
-- then lock the lots being reserved (serializes against clerk undo). Voiding a
-- pending payment now only frees lots still 'sold_live', same as
-- desk_fail_payment. Bodies are otherwise unchanged. Signatures are unchanged,
-- so grants carry over.
-- ============================================================================

begin;

create or replace function public.desk_record_cash(p_actor text, p_bidder uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.auction_bidders; v_ids uuid[]; v_goods int; v_pay uuid;
begin
  select * into b from public.auction_bidders where id = p_bidder for update;
  if not found then raise exception 'unknown bidder number' using errcode = 'no_data_found'; end if;
  perform public.auction_require_organizer(b.auction_id, p_actor);
  perform 1 from public.auction_lots
   where sold_to_bidder_id = b.id and status = 'sold_live' and desk_payment_id is null
   for update;
  select array_agg(id), coalesce(sum(hammer_cents), 0) into v_ids, v_goods
    from public.auction_lots
   where sold_to_bidder_id = b.id and status = 'sold_live' and desk_payment_id is null;
  if v_ids is null then raise exception 'nothing to pay for this bidder' using errcode = 'check_violation'; end if;

  insert into public.auction_desk_payments (auction_id, bidder_id, method, status, lot_ids, goods_cents, total_cents, recorded_by, paid_at)
  values (b.auction_id, b.id, 'cash', 'paid', v_ids, v_goods, v_goods, lower(p_actor), now())
  returning id into v_pay;
  update public.auction_lots
     set status = 'handed_off', payment_method = 'cash', desk_payment_id = v_pay, paid_at = now(), handed_off_at = now()
   where id = any(v_ids);
  return jsonb_build_object('paymentId', v_pay, 'lots', array_length(v_ids, 1), 'goodsCents', v_goods);
end;
$$;

create or replace function public.desk_begin_card_payment(
  p_actor text, p_bidder uuid, p_method text, p_platform_fee integer, p_processing_fee integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.auction_bidders; v_ids uuid[]; v_goods int; v_pay uuid;
begin
  if p_method not in ('card_checkout', 'card_saved') then raise exception 'unknown method' using errcode = 'invalid_parameter_value'; end if;
  select * into b from public.auction_bidders where id = p_bidder for update;
  if not found then raise exception 'unknown bidder number' using errcode = 'no_data_found'; end if;
  perform public.auction_require_organizer(b.auction_id, p_actor);

  -- A card payment still pending for this bidder is voided so a fresh one can start.
  update public.auction_lots set desk_payment_id = null
   where desk_payment_id in (select id from public.auction_desk_payments where bidder_id = b.id and status = 'pending')
     and status = 'sold_live';
  update public.auction_desk_payments set status = 'void' where bidder_id = b.id and status = 'pending';

  perform 1 from public.auction_lots
   where sold_to_bidder_id = b.id and status = 'sold_live' and desk_payment_id is null
   for update;
  select array_agg(id), coalesce(sum(hammer_cents), 0) into v_ids, v_goods
    from public.auction_lots
   where sold_to_bidder_id = b.id and status = 'sold_live' and desk_payment_id is null;
  if v_ids is null then raise exception 'nothing to pay for this bidder' using errcode = 'check_violation'; end if;

  insert into public.auction_desk_payments (auction_id, bidder_id, method, status, lot_ids, goods_cents,
                                            platform_fee_cents, processing_fee_cents, total_cents, recorded_by)
  values (b.auction_id, b.id, p_method, 'pending', v_ids, v_goods,
          greatest(0, coalesce(p_platform_fee, 0)), greatest(0, coalesce(p_processing_fee, 0)),
          v_goods + greatest(0, coalesce(p_processing_fee, 0)), lower(p_actor))
  returning id into v_pay;
  update public.auction_lots set desk_payment_id = v_pay where id = any(v_ids);
  return jsonb_build_object('paymentId', v_pay, 'lotIds', to_jsonb(v_ids), 'goodsCents', v_goods,
                            'auctionId', b.auction_id, 'bidderNumber', b.bidder_number, 'bidderName', b.name, 'wallet', b.wallet);
end;
$$;

-- create or replace keeps grants, but check anyway: server only.
do $$
begin
  if has_function_privilege('anon', 'public.desk_record_cash(text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.desk_record_cash(text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.desk_begin_card_payment(text, uuid, text, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.desk_begin_card_payment(text, uuid, text, integer, integer)', 'execute') then
    raise exception 'browser roles can execute desk functions';
  end if;
  if not has_function_privilege('service_role', 'public.desk_begin_card_payment(text, uuid, text, integer, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.desk_record_cash(text, uuid)', 'execute') then
    raise exception 'service_role lost execute on desk functions';
  end if;
end;
$$;

commit;
