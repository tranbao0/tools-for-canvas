/**
 * The full JSON shapes that Canvas sends, as serialized by canvas-lms at commit 1c9f0bb.
 *
 * Each type extends the shared contract type in `src/lib/canvas/types.ts` with the fields
 * that Canvas sends and the extension ignores, so a fixture value is assignable to the
 * contract type and parsing code still sees every real field.
 *
 * Sources in canvas-lms: lib/api/v1/{planner_item,planner_override,planner_note,assignment,
 * submission,course,course_json,enrollment_term,group,user,user_profile,locked}.rb and
 * app/graphql/types/{course_type,custom_grade_status_type}.rb.
 * Ids are strings because every request sends `Accept: application/json+canvas-string-ids`.
 */
import type {
  Assignment,
  Course,
  Group,
  PlannerItem,
  PlannerOverride,
  PlannerSubmissions,
  Profile,
  Submission,
  Term,
  UserSelf,
} from '../../src/lib/canvas/types';

export interface WireUserSelf extends UserSelf {
  created_at: string;
  sortable_name: string;
  short_name: string;
  avatar_url: string;
  last_name: string;
  first_name: string;
  locale: string | null;
  effective_locale: string;
  permissions: {
    can_update_name: boolean;
    can_update_avatar: boolean;
    limit_parent_app_web_access: boolean;
  };
}

export interface WireProfile extends Profile {
  short_name: string;
  sortable_name: string;
  avatar_url: string;
  title: string | null;
  bio: string | null;
  pronunciation: string | null;
  primary_email: string;
  login_id: string;
  integration_id: string | null;
  calendar: { ics: string };
  k5_user: boolean;
  use_classic_font_in_k5: boolean;
}

export interface WireTerm extends Term {
  workflow_state: 'active';
  grading_period_group_id: string | null;
  created_at: string;
}

export interface WireEnrollment {
  type: 'student' | 'ta' | 'teacher' | 'designer' | 'observer';
  role: string;
  role_id: string;
  user_id: string;
  enrollment_state: 'active' | 'invited' | 'completed';
  limit_privileges_to_course_section: boolean;
}

export interface WireCourse extends Course {
  account_id: string;
  created_at: string;
  start_at: string | null;
  default_view: 'modules' | 'wiki' | 'feed' | 'assignments' | 'syllabus';
  enrollment_term_id: string;
  is_public: boolean;
  grading_standard_id: string | null;
  root_account_id: string;
  uuid: string;
  license: string;
  grade_passback_setting: string | null;
  end_at: string | null;
  public_syllabus: boolean;
  public_syllabus_to_auth: boolean;
  storage_quota_mb: number;
  is_public_to_auth_users: boolean;
  homeroom_course: boolean;
  course_color: string | null;
  friendly_name: string | null;
  apply_assignment_group_weights: boolean;
  calendar: { ics: string };
  time_zone: string;
  blueprint: boolean;
  template: boolean;
  enrollments: WireEnrollment[];
  hide_final_grades: boolean;
  workflow_state: 'available';
  restrict_enrollments_to_course_dates: boolean;
  term: WireTerm;
}

export interface WireGroup extends Group {
  description: string | null;
  is_public: boolean;
  join_level: 'parent_context_auto_join' | 'parent_context_request' | 'invitation_only';
  group_category_id: string;
  max_membership: number | null;
  created_at: string;
  members_count: number;
  storage_quota_mb: number;
  context_type: 'Course' | 'Account';
  /** Set for a course group. */
  course_id?: string;
  /** Set for an account group. */
  account_id?: string;
  context_name: string;
  avatar_url: string | null;
  role: string | null;
  leader: null;
  has_submission: boolean;
  concluded: boolean;
  non_collaborative: boolean;
}

export interface WireColors {
  custom_colors: Record<string, string>;
}

export interface WireDashboardPositions {
  dashboard_positions: Record<string, number>;
}

export interface WirePlannerOverride extends PlannerOverride {
  workflow_state: 'active' | 'unpublished' | 'deleted';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface WireFeedback {
  comment: string;
  is_media: boolean;
  author_name: string;
  author_avatar_url: string;
}

export interface WirePlannerSubmissions extends PlannerSubmissions {
  posted_at: string | null;
  /** Present only when `has_feedback` is true. */
  feedback?: WireFeedback;
}

/**
 * A planner item. `context_image` (course rows) and `details` (`sub_assignment` rows) are in the
 * contract type. Planner notes from `GET /api/v1/planner_notes` use the contract `PlannerNote`
 * as is, because it has every field Canvas sends.
 */
export interface WirePlannerItem extends PlannerItem {
  planner_override: WirePlannerOverride | null;
  submissions: false | WirePlannerSubmissions;
}

export interface WireAttachment {
  id: string;
  uuid: string;
  folder_id: string | null;
  display_name: string;
  filename: string;
  upload_status: 'success';
  'content-type': string;
  url: string;
  size: number;
  created_at: string;
  updated_at: string;
  unlock_at: string | null;
  locked: boolean;
  hidden: boolean;
  lock_at: string | null;
  hidden_for_user: boolean;
  thumbnail_url: string | null;
  modified_at: string;
  mime_class: string;
  media_entry_id: string | null;
  category: string;
  locked_for_user: boolean;
  preview_url: string | null;
}

export interface WireSubmission extends Submission {
  user_id: string;
  url: string | null;
  attempt: number | null;
  submission_type: string | null;
  body: string | null;
  graded_at: string | null;
  grade_matches_current_submission: boolean;
  grader_id: string | null;
  points_deducted: number | null;
  grading_period_id: string | null;
  extra_attempts: number | null;
  posted_at: string | null;
  redo_request: boolean;
  sticker: string | null;
  seconds_late: number;
  entered_grade: string | null;
  entered_score: number | null;
  preview_url: string;
  attachments?: WireAttachment[];
  /** `basic_lti_launch` submissions only. */
  external_tool_url?: string;
}

export interface WireExternalToolTag {
  url: string;
  new_tab: boolean;
  external_data: string | null;
  resource_link_id: string;
  resource_link_title: string;
  content_type: 'ContextExternalTool';
  content_id: string;
  custom_params: Record<string, string> | null;
}

export type WireLockInfo =
  | { asset_string: string; unlock_at: string }
  | { asset_string: string; lock_at: string; can_view: true };

export interface WireAvailabilityStatus {
  status: 'pending' | 'open' | 'closed';
  date: string | null;
}

export interface WireCheckpoint {
  name: string;
  tag: 'reply_to_topic' | 'reply_to_entry';
  points_possible: number;
  due_at: string | null;
  only_visible_to_overrides: boolean;
  overrides: never[];
  unlock_at: string | null;
  lock_at: string | null;
}

export interface WireDiscussionTopic {
  id: string;
  title: string;
  assignment_id: string | null;
  delayed_post_at: string | null;
  lock_at: string | null;
  created_at: string;
  last_reply_at: string | null;
  posted_at: string;
  root_topic_id: string | null;
  podcast_has_student_posts: boolean;
  discussion_type: 'threaded' | 'side_comment' | 'not_threaded';
  position: number | null;
  allow_rating: boolean;
  only_graders_can_rate: boolean;
  sort_by_rating: boolean;
  is_section_specific: boolean;
  anonymous_state: string | null;
  summary_enabled: boolean;
  user_name: string;
  discussion_subentry_count: number;
  require_initial_post: boolean;
  user_can_see_posts: boolean;
  podcast_url: string | null;
  read_state: 'read' | 'unread';
  unread_count: number;
  subscribed: boolean;
  attachments: never[];
  published: boolean;
  can_unpublish: boolean;
  locked: boolean;
  can_lock: boolean;
  comments_disabled: boolean;
  author: {
    id: string;
    anonymous_id: string;
    display_name: string;
    avatar_image_url: string;
    html_url: string;
    pronouns: string | null;
  };
  html_url: string;
  url: string;
  pinned: boolean;
  group_category_id: string | null;
  can_group: boolean;
  topic_children: string[];
  group_topic_children: { id: string; group_id: string }[];
  locked_for_user: boolean;
  message: string;
  todo_date: string | null;
  is_announcement: boolean;
  sort_order: 'asc' | 'desc';
  sort_order_locked: boolean;
  expanded: boolean;
  expanded_locked: boolean;
  /** Checkpointed discussions only. */
  reply_to_entry_required_count?: number;
  is_checkpointed?: boolean;
}

export interface WireAssignment extends Assignment {
  description: string | null;
  due_at: string | null;
  unlock_at: string | null;
  lock_at: string | null;
  points_possible: number | null;
  grading_type: 'points' | 'percent' | 'letter_grade' | 'gpa_scale' | 'pass_fail' | 'not_graded';
  assignment_group_id: string;
  grading_standard_id: string | null;
  created_at: string;
  updated_at: string;
  peer_reviews: boolean;
  automatic_peer_reviews: boolean;
  position: number;
  grade_group_students_individually: boolean;
  anonymous_peer_reviews: boolean;
  group_category_id: string | null;
  post_to_sis: boolean;
  moderated_grading: boolean;
  omit_from_final_grade: boolean;
  intra_group_peer_reviews: boolean;
  anonymous_instructor_annotations: boolean;
  anonymous_grading: boolean;
  graders_anonymous_to_graders: boolean;
  grader_count: number;
  grader_comments_visible_to_graders: boolean;
  final_grader_id: string | null;
  grader_names_visible_to_final_grader: boolean;
  allowed_attempts: number;
  annotatable_attachment_id: string | null;
  hide_in_gradebook: boolean;
  suppress_assignment: boolean;
  secure_params: string;
  lti_context_id: string;
  course_id: string;
  name: string;
  submission_types: string[];
  has_submitted_submissions: boolean;
  due_date_required: boolean;
  max_name_length: number;
  in_closed_grading_period: boolean;
  availability_status?: WireAvailabilityStatus;
  graded_submissions_exist: boolean;
  is_quiz_assignment: boolean;
  can_duplicate: boolean;
  original_course_id: string | null;
  original_assignment_id: string | null;
  original_lti_resource_link_id: string | null;
  original_assignment_name: string | null;
  original_quiz_id: string | null;
  workflow_state: 'published';
  important_dates: boolean;
  is_quiz_lti_assignment?: boolean;
  frozen_attributes?: string[];
  settings?: Record<string, unknown> | null;
  external_tool_tag_attributes?: WireExternalToolTag;
  /** External tool assignments only: the sessionless launch URL. */
  url?: string;
  muted: boolean;
  html_url: string;
  quiz_id?: string;
  anonymous_submissions?: boolean;
  discussion_topic?: WireDiscussionTopic;
  peer_review_count?: number;
  peer_reviews_assign_at?: string | null;
  published: true;
  only_visible_to_overrides: boolean;
  visible_to_everyone: boolean;
  submission?: WireSubmission;
  /** Present when the request has a `bucket` parameter. */
  bucket?: 'undated' | 'past' | 'overdue' | 'ungraded' | 'unsubmitted' | 'upcoming' | 'future';
  locked_for_user: boolean;
  lock_info?: WireLockInfo;
  lock_explanation?: string;
  submissions_download_url: string;
  post_manually: boolean;
  anonymize_students: boolean;
  new_quizzes_anonymous_participants: boolean;
  require_lockdown_browser: boolean;
  restrict_quantitative_data: boolean;
  /** Present only with `include[]=checkpoints`. */
  has_sub_assignments?: boolean;
  checkpoints?: WireCheckpoint[];
}

export interface WireGraphqlCustomGradeStatusNode {
  _id: string;
  name: string;
}

/**
 * The body of the `POST /api/graphql` answer to the teacher status query: one entry per alias of
 * the query, such as `c0`. An entry is null for a course Canvas does not find, and its
 * connection is null when the feature is off.
 */
export interface WireGraphqlCustomGradeStatusesBody {
  data: Record<
    string,
    { customGradeStatusesConnection: { nodes: WireGraphqlCustomGradeStatusNode[] } | null } | null
  >;
}
