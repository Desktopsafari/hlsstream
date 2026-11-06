// The announcement data layer. Every read and write of the announcements
// table lives in this folder; routes and the admin call it through this file
// and never query that table themselves.
//
// Scope: stream_id null = site-wide (shown on every stream page), otherwise
// only that stream's page. Server-only.

export {
  createAnnouncement,
  deleteAnnouncement,
  listAdminAnnouncements,
  updateAnnouncement,
} from "@/lib/data/announcements/manage";
export {
  attachPendingImage,
  cleanupPendingAnnouncementImages,
  clearAnnouncementImage,
  deletePendingImage,
  isPendingPath,
  removeFileIfUnreferenced,
  setAnnouncementImage,
  uploadPendingImage,
  type ImageFailure,
  type ImageResult,
} from "@/lib/data/announcements/images";
export { getVisibleAnnouncements, loadStreamAnnouncements } from "@/lib/data/announcements/public";
export {
  ANNOUNCEMENT_COLUMNS,
  ANNOUNCEMENTS_SQL_HINT,
  BUTTON_LABEL_MAX,
  MESSAGE_MAX,
  SCOPE_ERROR,
  TITLE_MAX,
  announcementImageUrl,
  announcementStatus,
  cleanText,
  inStreamScope,
  isAnnouncementVisible,
  isMissingTable,
  parseAnnouncementInput,
  parseScope,
  pickVisible,
  toAdminAnnouncement,
  toPublicAnnouncement,
  type AdminResult,
  type AnnouncementFields,
  type AnnouncementRow,
  type AnnouncementStatus,
} from "@/lib/data/announcements/rules";
