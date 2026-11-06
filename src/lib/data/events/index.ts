// The suggestion (naming) event data layer. Every read and write of
// suggestion_events, suggestion_event_frogs and name_suggestions lives in this
// folder; routes and the admin call it through this file and never query
// those tables themselves.
//
// Scope: each event belongs to one stream; its frogs and name ideas follow it
// through event_id. Server-only.

export { addFrog, clearFrogImage, removeFrog, setFrogImage } from "@/lib/data/events/frogs";
export { createEvent, findEventInStream, listAdminEvents, updateEvent } from "@/lib/data/events/manage";
export { deleteName, listNameSuggestions, setNameShortlisted } from "@/lib/data/events/names";
export { getActiveEvent, getPublicEventPayload, submitNameSuggestion } from "@/lib/data/events/public";
export {
  EVENT_COLUMNS,
  eventImageUrl,
  isEventActive,
  type EventFrogRow,
  type EventResult,
  type EventRow,
} from "@/lib/data/events/rules";
