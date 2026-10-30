/**
 * The JSON shapes of the trimmed fixtures.
 *
 * A fixture holds the required fields of the contract types in `src/shared/canvas/types.ts` and the
 * optional fields that production code reads. So most fixtures use those types as they are. The
 * types here add what the contract types do not have.
 * `full-replies.ts` holds the complete Canvas replies, with every field that Canvas sends.
 */
import type { Assignment } from '../../src/shared/canvas/types';

/** An assignment with `locked_for_user`, which Canvas computes from `unlock_at` and `lock_at`. */
export interface WireAssignment extends Assignment {
  locked_for_user: boolean;
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
