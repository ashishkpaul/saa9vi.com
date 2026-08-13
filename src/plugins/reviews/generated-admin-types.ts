export * from "../bigbluebutton-plugin/generated-admin-types";

export interface MutationApproveProductReviewArgs {
  id: string;
}

export interface MutationRejectProductReviewArgs {
  id: string;
}

export interface MutationUpdateProductReviewArgs {
  input: any;
}

export interface MutationHideProductReviewArgs {
  id: string;
}

export interface MutationFlagProductReviewArgs {
  id: string;
  reason?: string | null;
}

export interface QueryProductReviewArgs {
  id: string;
}

export interface QueryProductReviewsArgs {
  options?: any;
}
