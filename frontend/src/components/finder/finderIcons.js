/**
 * finderIcons.js — Phosphor icons for the Fish Finder filter chips (Daylight).
 *
 * WATER_FILTERS (waterFilter.js) and DISCOVERY_INTENTS (discoveryIntents.js)
 * still carry emoji `icon` fields. Those modules are pure and shared, so they
 * are left alone; the finder simply stops rendering the emoji and looks the
 * icon up here by the same id.
 */
import {
  SquaresFour,
  Drop,
  Waves,
  Shrimp,
  Plant,
  UsersThree,
  ArrowsInSimple,
  Star,
  Broom,
  Snowflake,
} from "@phosphor-icons/react";

/** Water filter id → icon component. */
export const WATER_ICON = Object.freeze({
  all: SquaresFour,
  freshwater: Drop,
  marine: Waves,
  reef_life: Shrimp,
});

/** Discovery intent id → icon component. */
export const INTENT_ICON = Object.freeze({
  beginner: Plant,
  peaceful: UsersThree,
  nano: ArrowsInSimple,
  centerpiece: Star,
  cleanup: Broom,
  coldwater: Snowflake,
});
