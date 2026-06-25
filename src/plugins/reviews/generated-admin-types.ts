export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  DateTime: { input: string; output: string; }
  JSON: { input: Record<string, any>; output: Record<string, any>; }
  Money: { input: number; output: number; }
  Upload: { input: any; output: any; }
};

export type AddBbbMemberInput = {
  customerId: Scalars['ID']['input'];
  organizationId: Scalars['ID']['input'];
  role: Scalars['String']['input'];
};

export type AddFulfillmentToOrderResult = CreateFulfillmentError | EmptyOrderLineSelectionError | Fulfillment | FulfillmentStateTransitionError | InsufficientStockOnHandError | InvalidFulfillmentHandlerError | ItemsAlreadyFulfilledError;

export type AddItemInput = {
  productVariantId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
};

export type AddItemToDraftOrderInput = {
  productVariantId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
};

export type AddManualPaymentToOrderResult = ManualPaymentStateError | Order;

export type AddNoteToCustomerInput = {
  id: Scalars['ID']['input'];
  isPublic: Scalars['Boolean']['input'];
  note: Scalars['String']['input'];
};

export type AddNoteToOrderInput = {
  id: Scalars['ID']['input'];
  isPublic: Scalars['Boolean']['input'];
  note: Scalars['String']['input'];
};

export type Address = Node & {
  city?: Maybe<Scalars['String']['output']>;
  company?: Maybe<Scalars['String']['output']>;
  country: Country;
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  defaultBillingAddress?: Maybe<Scalars['Boolean']['output']>;
  defaultShippingAddress?: Maybe<Scalars['Boolean']['output']>;
  fullName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  phoneNumber?: Maybe<Scalars['String']['output']>;
  postalCode?: Maybe<Scalars['String']['output']>;
  province?: Maybe<Scalars['String']['output']>;
  streetLine1: Scalars['String']['output'];
  streetLine2?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type AdjustDraftOrderLineInput = {
  orderLineId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
};

export type Adjustment = {
  adjustmentSource: Scalars['String']['output'];
  amount: Scalars['Money']['output'];
  data?: Maybe<Scalars['JSON']['output']>;
  description: Scalars['String']['output'];
  type: AdjustmentType;
};

export type AdjustmentType =
  | 'DISTRIBUTED_ORDER_PROMOTION'
  | 'OTHER'
  | 'PROMOTION';

export type AdminBudgetAdjustmentInput = {
  /**  Target seller's billing account ID  */
  accountId: Scalars['ID']['input'];
  /**  CREDIT or DEBIT  */
  adjustmentType: Scalars['String']['input'];
  /**  Amount in minor currency units  */
  amount: Scalars['Int']['input'];
  /**  Mandatory idempotency key to prevent double adjustments  */
  idempotencyKey: Scalars['String']['input'];
  /**  Audit reason displayed in the ledger  */
  reason: Scalars['String']['input'];
};

export type AdminBudgetAdjustmentResult = {
  accountId: Scalars['ID']['output'];
  adjustmentType: Scalars['String']['output'];
  amount: Scalars['Int']['output'];
  balanceAfter: Scalars['Int']['output'];
  reason?: Maybe<Scalars['String']['output']>;
};

export type Administrator = Node & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  emailAddress: Scalars['String']['output'];
  firstName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastName: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  user: User;
};

export type AdministratorFilterParameter = {
  _and?: InputMaybe<Array<AdministratorFilterParameter>>;
  _or?: InputMaybe<Array<AdministratorFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  emailAddress?: InputMaybe<StringOperators>;
  firstName?: InputMaybe<StringOperators>;
  id?: InputMaybe<IdOperators>;
  lastName?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type AdministratorList = PaginatedList & {
  items: Array<Administrator>;
  totalItems: Scalars['Int']['output'];
};

export type AdministratorListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<AdministratorFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<AdministratorSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type AdministratorPaymentInput = {
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  paymentMethod?: InputMaybe<Scalars['String']['input']>;
};

export type AdministratorRefundInput = {
  /**
   * The amount to be refunded to this particular Payment. This was introduced in
   * v2.2.0 as the preferred way to specify the refund amount. The `lines`, `shipping` and `adjustment`
   * fields will be removed in a future version.
   */
  amount?: InputMaybe<Scalars['Money']['input']>;
  paymentId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};

export type AdministratorSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  emailAddress?: InputMaybe<SortOrder>;
  firstName?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  lastName?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type Allocation = Node & StockMovement & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  orderLine: OrderLine;
  productVariant: ProductVariant;
  quantity: Scalars['Int']['output'];
  type: StockMovementType;
  updatedAt: Scalars['DateTime']['output'];
};

/** Returned if an attempting to refund an OrderItem which has already been refunded */
export type AlreadyRefundedError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
  refundId: Scalars['ID']['output'];
};

export type ApplyCouponCodeResult = CouponCodeExpiredError | CouponCodeInvalidError | CouponCodeLimitError | Order;

export type Asset = Node & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  fileSize: Scalars['Int']['output'];
  focalPoint?: Maybe<Coordinate>;
  height: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  mimeType: Scalars['String']['output'];
  name: Scalars['String']['output'];
  preview: Scalars['String']['output'];
  source: Scalars['String']['output'];
  tags: Array<Tag>;
  type: AssetType;
  updatedAt: Scalars['DateTime']['output'];
  width: Scalars['Int']['output'];
};

export type AssetFilterParameter = {
  _and?: InputMaybe<Array<AssetFilterParameter>>;
  _or?: InputMaybe<Array<AssetFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  fileSize?: InputMaybe<NumberOperators>;
  height?: InputMaybe<NumberOperators>;
  id?: InputMaybe<IdOperators>;
  mimeType?: InputMaybe<StringOperators>;
  name?: InputMaybe<StringOperators>;
  preview?: InputMaybe<StringOperators>;
  source?: InputMaybe<StringOperators>;
  type?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
  width?: InputMaybe<NumberOperators>;
};

export type AssetList = PaginatedList & {
  items: Array<Asset>;
  totalItems: Scalars['Int']['output'];
};

export type AssetListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<AssetFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<AssetSortParameter>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  tagsOperator?: InputMaybe<LogicalOperator>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type AssetSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  fileSize?: InputMaybe<SortOrder>;
  height?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  mimeType?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  preview?: InputMaybe<SortOrder>;
  source?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
  width?: InputMaybe<SortOrder>;
};

export type AssetType =
  | 'BINARY'
  | 'IMAGE'
  | 'VIDEO';

export type AssignAssetsToChannelInput = {
  assetIds: Array<Scalars['ID']['input']>;
  channelId: Scalars['ID']['input'];
};

export type AssignCollectionsToChannelInput = {
  channelId: Scalars['ID']['input'];
  collectionIds: Array<Scalars['ID']['input']>;
};

export type AssignFacetsToChannelInput = {
  channelId: Scalars['ID']['input'];
  facetIds: Array<Scalars['ID']['input']>;
};

export type AssignPaymentMethodsToChannelInput = {
  channelId: Scalars['ID']['input'];
  paymentMethodIds: Array<Scalars['ID']['input']>;
};

export type AssignProductVariantsToChannelInput = {
  channelId: Scalars['ID']['input'];
  priceFactor?: InputMaybe<Scalars['Float']['input']>;
  productVariantIds: Array<Scalars['ID']['input']>;
};

export type AssignProductsToChannelInput = {
  channelId: Scalars['ID']['input'];
  priceFactor?: InputMaybe<Scalars['Float']['input']>;
  productIds: Array<Scalars['ID']['input']>;
};

export type AssignPromotionPlanInput = {
  channelId: Scalars['ID']['input'];
  planId: Scalars['ID']['input'];
  renewsAt?: InputMaybe<Scalars['DateTime']['input']>;
  sellerId: Scalars['ID']['input'];
  startsAt?: InputMaybe<Scalars['DateTime']['input']>;
};

export type AssignPromotionsToChannelInput = {
  channelId: Scalars['ID']['input'];
  promotionIds: Array<Scalars['ID']['input']>;
};

export type AssignShippingMethodsToChannelInput = {
  channelId: Scalars['ID']['input'];
  shippingMethodIds: Array<Scalars['ID']['input']>;
};

export type AssignStockLocationsToChannelInput = {
  channelId: Scalars['ID']['input'];
  stockLocationIds: Array<Scalars['ID']['input']>;
};

export type AuthenticationInput = {
  native?: InputMaybe<NativeAuthInput>;
};

export type AuthenticationMethod = Node & {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  strategy: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type AuthenticationResult = CurrentUser | InvalidCredentialsError;

export type BackfillResult = {
  durationMs: Scalars['Int']['output'];
  productsUpdated: Scalars['Int']['output'];
  sellersProcessed: Scalars['Int']['output'];
};

export type BbbCapacityGrant = {
  consumedHours: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  exhausted: Scalars['Boolean']['output'];
  grantedHours: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  orderId?: Maybe<Scalars['ID']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  validFrom: Scalars['DateTime']['output'];
  validUntil: Scalars['DateTime']['output'];
};

export type BbbMeeting = {
  bbbMeetingId?: Maybe<Scalars['String']['output']>;
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  failureReason?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  organization: BbbOrganization;
  provisionedAt?: Maybe<Scalars['DateTime']['output']>;
  recordingEnabled: Scalars['Boolean']['output'];
  retryCount: Scalars['Int']['output'];
  state: Scalars['String']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type BbbMeetingList = {
  items: Array<BbbMeeting>;
  totalItems: Scalars['Int']['output'];
};

export type BbbMeetingListOptions = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type BbbOrganization = {
  channelId: Scalars['ID']['output'];
  concurrentMeetingLimit: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  maxParticipantsPerMeeting: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  recordingEnabled: Scalars['Boolean']['output'];
  slug: Scalars['String']['output'];
  suspended: Scalars['Boolean']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type BbbOrganizationList = {
  items: Array<BbbOrganization>;
  totalItems: Scalars['Int']['output'];
};

export type BbbOrganizationListOptions = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type BbbOrganizationMember = {
  active: Scalars['Boolean']['output'];
  createdAt: Scalars['DateTime']['output'];
  customerEmail?: Maybe<Scalars['String']['output']>;
  customerId: Scalars['ID']['output'];
  customerName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  keycloakSub?: Maybe<Scalars['String']['output']>;
  organizationId: Scalars['ID']['output'];
  role: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type BbbOrganizationMemberList = {
  items: Array<BbbOrganizationMember>;
  totalItems: Scalars['Int']['output'];
};

export type BbbOrganizationMemberListOptions = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

/**
 * A persistent UX abstraction for a recurring meeting space.
 * Rooms are long-lived; meetings are ephemeral runtime records created on-demand.
 */
export type BbbRoom = {
  createdAt: Scalars['DateTime']['output'];
  createdByCustomerId?: Maybe<Scalars['ID']['output']>;
  currentMeetingId?: Maybe<Scalars['ID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  lastProvisionRequestedAt?: Maybe<Scalars['DateTime']['output']>;
  maxParticipants?: Maybe<Scalars['Int']['output']>;
  name: Scalars['String']['output'];
  organizationId: Scalars['ID']['output'];
  recordingEnabled: Scalars['Boolean']['output'];
  retryCount: Scalars['Int']['output'];
  slug?: Maybe<Scalars['String']['output']>;
  state: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type BbbRoomList = {
  items: Array<BbbRoom>;
  totalItems: Scalars['Int']['output'];
};

export type BbbRoomListOptions = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type BbbScheduledSession = {
  activeMeetingId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['DateTime']['output'];
  endTime: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  organization: BbbOrganization;
  startTime: Scalars['DateTime']['output'];
  status: Scalars['String']['output'];
  title: Scalars['String']['output'];
  trainerId: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type BbbServer = {
  apiUrl: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  currentLoad: Scalars['Int']['output'];
  enabled: Scalars['Boolean']['output'];
  healthy: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  lastHealthCheckAt?: Maybe<Scalars['DateTime']['output']>;
  maxLoad: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type BbbServerList = {
  items: Array<BbbServer>;
  totalItems: Scalars['Int']['output'];
};

export type BbbServerListOptions = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type BooleanCustomFieldConfig = CustomField & {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

/** Operators for filtering on a list of Boolean fields */
export type BooleanListOperators = {
  inList: Scalars['Boolean']['input'];
};

/** Operators for filtering on a Boolean field */
export type BooleanOperators = {
  eq?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
};

export type BooleanStructFieldConfig = StructField & {
  description?: Maybe<Array<LocalizedString>>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type BulkTransitionError = {
  error: Scalars['String']['output'];
  id: Scalars['ID']['output'];
};

export type BulkTransitionResult = {
  failed: Array<BulkTransitionError>;
  succeeded: Array<Scalars['ID']['output']>;
};

export type BulkTransitionSellerStateResult = {
  message: Scalars['String']['output'];
  queued: Scalars['Int']['output'];
  success: Scalars['Boolean']['output'];
};

export type BusinessHours = {
  timezone: Scalars['String']['output'];
  weekly: Array<BusinessHoursDay>;
};

export type BusinessHoursDay = {
  close: Scalars['String']['output'];
  day: Scalars['Int']['output'];
  isClosed: Scalars['Boolean']['output'];
  open: Scalars['String']['output'];
};

export type BusinessHoursDayInput = {
  close: Scalars['String']['input'];
  day: Scalars['Int']['input'];
  isClosed: Scalars['Boolean']['input'];
  open: Scalars['String']['input'];
};

export type BusinessHoursInput = {
  timezone: Scalars['String']['input'];
  weekly: Array<BusinessHoursDayInput>;
};

/** Returned if an attempting to cancel lines from an Order which is still active */
export type CancelActiveOrderError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
  orderState: Scalars['String']['output'];
};

export type CancelDeliveryResult = {
  message: Scalars['String']['output'];
  success: Scalars['Boolean']['output'];
};

export type CancelOrderInput = {
  /** Specify whether the shipping charges should also be cancelled. Defaults to false */
  cancelShipping?: InputMaybe<Scalars['Boolean']['input']>;
  /** Optionally specify which OrderLines to cancel. If not provided, all OrderLines will be cancelled */
  lines?: InputMaybe<Array<OrderLineInput>>;
  /** The id of the order to be cancelled */
  orderId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};

export type CancelOrderResult = CancelActiveOrderError | EmptyOrderLineSelectionError | MultipleOrderError | Order | OrderStateTransitionError | QuantityTooGreatError;

/** Returned if the Payment cancellation fails */
export type CancelPaymentError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
  paymentErrorMessage: Scalars['String']['output'];
};

export type CancelPaymentResult = CancelPaymentError | Payment | PaymentStateTransitionError;

export type Cancellation = Node & StockMovement & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  orderLine: OrderLine;
  productVariant: ProductVariant;
  quantity: Scalars['Int']['output'];
  type: StockMovementType;
  updatedAt: Scalars['DateTime']['output'];
};

export type CashbackMarketplaceMetrics = {
  activeSellers: Scalars['Int']['output'];
  redeemedTodayPaise: Scalars['Int']['output'];
  totalAvailableCashbackPaise: Scalars['Int']['output'];
  totalPendingCashbackPaise: Scalars['Int']['output'];
  totalWalletLiabilityPaise: Scalars['Int']['output'];
};

export type CashbackPolicyState =
  | 'ACTIVE'
  | 'ARCHIVED'
  | 'DRAFT'
  | 'EXPIRED'
  | 'PAUSED';

/**
 * type: EARN | REDEEM | EXPIRE | REFUND_REV | REVERSAL
 * status: PENDING | AVAILABLE | REDEEMED | EXPIRED | CANCELLED | REVERSED | SETTLED
 */
export type CashbackTransaction = {
  amountPaise: Scalars['Int']['output'];
  availableAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  redemptionOrderId?: Maybe<Scalars['ID']['output']>;
  sellerOrderId?: Maybe<Scalars['ID']['output']>;
  settledAt?: Maybe<Scalars['DateTime']['output']>;
  sourceSellerId: Scalars['ID']['output'];
  status: Scalars['String']['output'];
  type: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  walletId: Scalars['ID']['output'];
};

export type CashbackTransactionFilterInput = {
  redemptionOrderId?: InputMaybe<IdOperators>;
  sellerOrderId?: InputMaybe<IdOperators>;
  sourceSellerId?: InputMaybe<IdOperators>;
  status?: InputMaybe<StringOperators>;
  type?: InputMaybe<StringOperators>;
};

export type CashbackTransactionList = {
  items: Array<CashbackTransaction>;
  totalItems: Scalars['Int']['output'];
};

export type CashbackTransactionListOptions = {
  filter?: InputMaybe<CashbackTransactionFilterInput>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  sort?: InputMaybe<CashbackTransactionSortInput>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type CashbackTransactionSortInput = {
  amountPaise?: InputMaybe<SortOrder>;
  availableAt?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  expiresAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  settledAt?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type Channel = Node & {
  availableCurrencyCodes: Array<CurrencyCode>;
  availableLanguageCodes?: Maybe<Array<LanguageCode>>;
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  /** @deprecated Use defaultCurrencyCode instead */
  currencyCode: CurrencyCode;
  customFields?: Maybe<Scalars['JSON']['output']>;
  defaultCurrencyCode: CurrencyCode;
  defaultLanguageCode: LanguageCode;
  defaultShippingZone?: Maybe<Zone>;
  defaultTaxZone?: Maybe<Zone>;
  id: Scalars['ID']['output'];
  /** Not yet used - will be implemented in a future release. */
  outOfStockThreshold?: Maybe<Scalars['Int']['output']>;
  pricesIncludeTax: Scalars['Boolean']['output'];
  seller?: Maybe<Seller>;
  token: Scalars['String']['output'];
  /** Not yet used - will be implemented in a future release. */
  trackInventory?: Maybe<Scalars['Boolean']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

/**
 * Returned when the default LanguageCode of a Channel is no longer found in the `availableLanguages`
 * of the GlobalSettings
 */
export type ChannelDefaultLanguageError = ErrorResult & {
  channelCode: Scalars['String']['output'];
  errorCode: ErrorCode;
  language: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

export type ChannelFilterParameter = {
  _and?: InputMaybe<Array<ChannelFilterParameter>>;
  _or?: InputMaybe<Array<ChannelFilterParameter>>;
  code?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  currencyCode?: InputMaybe<StringOperators>;
  defaultCurrencyCode?: InputMaybe<StringOperators>;
  defaultLanguageCode?: InputMaybe<StringOperators>;
  id?: InputMaybe<IdOperators>;
  outOfStockThreshold?: InputMaybe<NumberOperators>;
  pricesIncludeTax?: InputMaybe<BooleanOperators>;
  token?: InputMaybe<StringOperators>;
  trackInventory?: InputMaybe<BooleanOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type ChannelList = PaginatedList & {
  items: Array<Channel>;
  totalItems: Scalars['Int']['output'];
};

export type ChannelListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<ChannelFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<ChannelSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type ChannelSortParameter = {
  code?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  outOfStockThreshold?: InputMaybe<SortOrder>;
  token?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type Collection = Node & {
  assets: Array<Asset>;
  breadcrumbs: Array<CollectionBreadcrumb>;
  children?: Maybe<Array<Collection>>;
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  description: Scalars['String']['output'];
  featuredAsset?: Maybe<Asset>;
  filters: Array<ConfigurableOperation>;
  id: Scalars['ID']['output'];
  inheritFilters: Scalars['Boolean']['output'];
  isPrivate: Scalars['Boolean']['output'];
  languageCode?: Maybe<LanguageCode>;
  name: Scalars['String']['output'];
  parent?: Maybe<Collection>;
  parentId: Scalars['ID']['output'];
  position: Scalars['Int']['output'];
  productVariants: ProductVariantList;
  slug: Scalars['String']['output'];
  translations: Array<CollectionTranslation>;
  updatedAt: Scalars['DateTime']['output'];
};


export type CollectionProductVariantsArgs = {
  options?: InputMaybe<ProductVariantListOptions>;
};

export type CollectionBreadcrumb = {
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
};

export type CollectionFilterParameter = {
  _and?: InputMaybe<Array<CollectionFilterParameter>>;
  _or?: InputMaybe<Array<CollectionFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  description?: InputMaybe<StringOperators>;
  id?: InputMaybe<IdOperators>;
  inheritFilters?: InputMaybe<BooleanOperators>;
  isPrivate?: InputMaybe<BooleanOperators>;
  languageCode?: InputMaybe<StringOperators>;
  name?: InputMaybe<StringOperators>;
  parentId?: InputMaybe<IdOperators>;
  position?: InputMaybe<NumberOperators>;
  slug?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type CollectionList = PaginatedList & {
  items: Array<Collection>;
  totalItems: Scalars['Int']['output'];
};

export type CollectionListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<CollectionFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<CollectionSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
  topLevelOnly?: InputMaybe<Scalars['Boolean']['input']>;
};

/**
 * Which Collections are present in the products returned
 * by the search, and in what quantity.
 */
export type CollectionResult = {
  collection: Collection;
  count: Scalars['Int']['output'];
};

export type CollectionSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  description?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  parentId?: InputMaybe<SortOrder>;
  position?: InputMaybe<SortOrder>;
  slug?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type CollectionTranslation = {
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

/** Phase 2 — A collection node for tree selector with children preview */
export type CollectionTreeNode = {
  children: Array<CollectionTreeNode>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  parentId?: Maybe<Scalars['ID']['output']>;
  slug: Scalars['String']['output'];
};

export type CommerceEligibility = {
  cartEligible: Scalars['Boolean']['output'];
  checkoutEligible: Scalars['Boolean']['output'];
  deliveryFee?: Maybe<Scalars['Int']['output']>;
  discoverable: Scalars['Boolean']['output'];
  etaMinutes?: Maybe<Scalars['Int']['output']>;
  fulfillmentModes: Array<Scalars['String']['output']>;
  minOrderSatisfied: Scalars['Boolean']['output'];
  openNow: Scalars['Boolean']['output'];
  reasonCodes: Array<Scalars['String']['output']>;
  sellerEligible: Scalars['Boolean']['output'];
  serviceable: Scalars['Boolean']['output'];
};

export type ConfigArg = {
  name: Scalars['String']['output'];
  value: Scalars['String']['output'];
};

export type ConfigArgDefinition = {
  defaultValue?: Maybe<Scalars['JSON']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  required: Scalars['Boolean']['output'];
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type ConfigArgInput = {
  name: Scalars['String']['input'];
  /** A JSON stringified representation of the actual value */
  value: Scalars['String']['input'];
};

export type ConfigurableOperation = {
  args: Array<ConfigArg>;
  code: Scalars['String']['output'];
};

export type ConfigurableOperationDefinition = {
  args: Array<ConfigArgDefinition>;
  code: Scalars['String']['output'];
  description: Scalars['String']['output'];
};

export type ConfigurableOperationInput = {
  arguments: Array<ConfigArgInput>;
  code: Scalars['String']['input'];
};

export type ConfirmPromotionTopupInput = {
  idempotencyKey: Scalars['String']['input'];
  intentId: Scalars['String']['input'];
};

export type Coordinate = {
  x: Scalars['Float']['output'];
  y: Scalars['Float']['output'];
};

export type CoordinateInput = {
  x: Scalars['Float']['input'];
  y: Scalars['Float']['input'];
};

/**
 * A Country of the world which your shop operates in.
 *
 * The `code` field is typically a 2-character ISO code such as "GB", "US", "DE" etc. This code is used in certain inputs such as
 * `UpdateAddressInput` and `CreateAddressInput` to specify the country.
 */
export type Country = Node & Region & {
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  parent?: Maybe<Region>;
  parentId?: Maybe<Scalars['ID']['output']>;
  translations: Array<RegionTranslation>;
  type: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type CountryFilterParameter = {
  _and?: InputMaybe<Array<CountryFilterParameter>>;
  _or?: InputMaybe<Array<CountryFilterParameter>>;
  code?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  enabled?: InputMaybe<BooleanOperators>;
  id?: InputMaybe<IdOperators>;
  languageCode?: InputMaybe<StringOperators>;
  name?: InputMaybe<StringOperators>;
  parentId?: InputMaybe<IdOperators>;
  type?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type CountryList = PaginatedList & {
  items: Array<Country>;
  totalItems: Scalars['Int']['output'];
};

export type CountryListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<CountryFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<CountrySortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type CountrySortParameter = {
  code?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  parentId?: InputMaybe<SortOrder>;
  type?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type CountryTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
};

/** Returned if the provided coupon code is invalid */
export type CouponCodeExpiredError = ErrorResult & {
  couponCode: Scalars['String']['output'];
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/** Returned if the provided coupon code is invalid */
export type CouponCodeInvalidError = ErrorResult & {
  couponCode: Scalars['String']['output'];
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/** Returned if the provided coupon code is invalid */
export type CouponCodeLimitError = ErrorResult & {
  couponCode: Scalars['String']['output'];
  errorCode: ErrorCode;
  limit: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

/**
 * Input used to create an Address.
 *
 * The countryCode must correspond to a `code` property of a Country that has been defined in the
 * Vendure server. The `code` property is typically a 2-character ISO code such as "GB", "US", "DE" etc.
 * If an invalid code is passed, the mutation will fail.
 */
export type CreateAddressInput = {
  city?: InputMaybe<Scalars['String']['input']>;
  company?: InputMaybe<Scalars['String']['input']>;
  countryCode: Scalars['String']['input'];
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  defaultBillingAddress?: InputMaybe<Scalars['Boolean']['input']>;
  defaultShippingAddress?: InputMaybe<Scalars['Boolean']['input']>;
  fullName?: InputMaybe<Scalars['String']['input']>;
  phoneNumber?: InputMaybe<Scalars['String']['input']>;
  postalCode?: InputMaybe<Scalars['String']['input']>;
  province?: InputMaybe<Scalars['String']['input']>;
  streetLine1: Scalars['String']['input'];
  streetLine2?: InputMaybe<Scalars['String']['input']>;
};

export type CreateAdministratorInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  emailAddress: Scalars['String']['input'];
  firstName: Scalars['String']['input'];
  lastName: Scalars['String']['input'];
  password: Scalars['String']['input'];
  roleIds: Array<Scalars['ID']['input']>;
};

export type CreateAssetInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  file: Scalars['Upload']['input'];
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type CreateAssetResult = Asset | MimeTypeError;

export type CreateBbbCapacityGrantInput = {
  grantedHours: Scalars['Int']['input'];
  organizationId: Scalars['ID']['input'];
  validFrom?: InputMaybe<Scalars['String']['input']>;
  validUntil?: InputMaybe<Scalars['String']['input']>;
};

export type CreateBbbMeetingInput = {
  organizationId: Scalars['ID']['input'];
  recordingEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  title: Scalars['String']['input'];
};

export type CreateBbbOrganizationInput = {
  channelId: Scalars['ID']['input'];
  concurrentMeetingLimit?: InputMaybe<Scalars['Int']['input']>;
  maxParticipantsPerMeeting?: InputMaybe<Scalars['Int']['input']>;
  name: Scalars['String']['input'];
  recordingEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  slug: Scalars['String']['input'];
};

export type CreateBbbRoomInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  maxParticipants?: InputMaybe<Scalars['Int']['input']>;
  name: Scalars['String']['input'];
  organizationId: Scalars['ID']['input'];
  recordingEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
};

export type CreateBbbScheduledSessionInput = {
  endTime: Scalars['String']['input'];
  organizationId: Scalars['ID']['input'];
  startTime: Scalars['String']['input'];
  title: Scalars['String']['input'];
  trainerId: Scalars['ID']['input'];
};

export type CreateBbbServerInput = {
  apiSecret: Scalars['String']['input'];
  apiUrl: Scalars['String']['input'];
  maxLoad?: InputMaybe<Scalars['Int']['input']>;
  name: Scalars['String']['input'];
};

export type CreateChannelInput = {
  availableCurrencyCodes?: InputMaybe<Array<CurrencyCode>>;
  availableLanguageCodes?: InputMaybe<Array<LanguageCode>>;
  code: Scalars['String']['input'];
  /** @deprecated Use defaultCurrencyCode instead */
  currencyCode?: InputMaybe<CurrencyCode>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  defaultCurrencyCode?: InputMaybe<CurrencyCode>;
  defaultLanguageCode: LanguageCode;
  defaultShippingZoneId: Scalars['ID']['input'];
  defaultTaxZoneId: Scalars['ID']['input'];
  outOfStockThreshold?: InputMaybe<Scalars['Int']['input']>;
  pricesIncludeTax: Scalars['Boolean']['input'];
  sellerId?: InputMaybe<Scalars['ID']['input']>;
  token: Scalars['String']['input'];
  trackInventory?: InputMaybe<Scalars['Boolean']['input']>;
};

export type CreateChannelResult = Channel | LanguageNotAvailableError;

export type CreateCollectionInput = {
  assetIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  featuredAssetId?: InputMaybe<Scalars['ID']['input']>;
  filters: Array<ConfigurableOperationInput>;
  inheritFilters?: InputMaybe<Scalars['Boolean']['input']>;
  isPrivate?: InputMaybe<Scalars['Boolean']['input']>;
  parentId?: InputMaybe<Scalars['ID']['input']>;
  translations: Array<CreateCollectionTranslationInput>;
};

export type CreateCollectionTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  description: Scalars['String']['input'];
  languageCode: LanguageCode;
  name: Scalars['String']['input'];
  slug: Scalars['String']['input'];
};

export type CreateCountryInput = {
  code: Scalars['String']['input'];
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  enabled: Scalars['Boolean']['input'];
  translations: Array<CountryTranslationInput>;
};

export type CreateCustomerGroupInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  customerIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  name: Scalars['String']['input'];
};

export type CreateCustomerInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  emailAddress: Scalars['String']['input'];
  firstName: Scalars['String']['input'];
  lastName: Scalars['String']['input'];
  phoneNumber?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type CreateCustomerResult = Customer | EmailAddressConflictError;

export type CreateFacetInput = {
  code: Scalars['String']['input'];
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  isPrivate: Scalars['Boolean']['input'];
  translations: Array<FacetTranslationInput>;
  values?: InputMaybe<Array<CreateFacetValueWithFacetInput>>;
};

export type CreateFacetValueInput = {
  code: Scalars['String']['input'];
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  facetId: Scalars['ID']['input'];
  translations: Array<FacetValueTranslationInput>;
};

export type CreateFacetValueWithFacetInput = {
  code: Scalars['String']['input'];
  translations: Array<FacetValueTranslationInput>;
};

/** Returned if an error is thrown in a FulfillmentHandler's createFulfillment method */
export type CreateFulfillmentError = ErrorResult & {
  errorCode: ErrorCode;
  fulfillmentHandlerError: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

export type CreateGroupOptionInput = {
  code: Scalars['String']['input'];
  translations: Array<ProductOptionGroupTranslationInput>;
};

export type CreatePaymentMethodInput = {
  checker?: InputMaybe<ConfigurableOperationInput>;
  code: Scalars['String']['input'];
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  enabled: Scalars['Boolean']['input'];
  handler: ConfigurableOperationInput;
  translations: Array<PaymentMethodTranslationInput>;
};

export type CreateProductCustomFieldsInput = {
  sellerIsVerified?: InputMaybe<Scalars['Boolean']['input']>;
  sellerOnboardingStatus?: InputMaybe<Scalars['String']['input']>;
  sellerOperationalStatus?: InputMaybe<Scalars['String']['input']>;
  sellerPromotionActive?: InputMaybe<Scalars['Boolean']['input']>;
  sellerPromotionBannerEligible?: InputMaybe<Scalars['Boolean']['input']>;
  sellerPromotionBidBoost?: InputMaybe<Scalars['Int']['input']>;
  sellerPromotionCampaignId?: InputMaybe<Scalars['String']['input']>;
  sellerPromotionScore?: InputMaybe<Scalars['Int']['input']>;
};

export type CreateProductInput = {
  assetIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  customFields?: InputMaybe<CreateProductCustomFieldsInput>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  facetValueIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  featuredAssetId?: InputMaybe<Scalars['ID']['input']>;
  translations: Array<ProductTranslationInput>;
};

export type CreateProductOptionGroupInput = {
  code: Scalars['String']['input'];
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  options: Array<CreateGroupOptionInput>;
  translations: Array<ProductOptionGroupTranslationInput>;
};

export type CreateProductOptionInput = {
  code: Scalars['String']['input'];
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  productOptionGroupId: Scalars['ID']['input'];
  translations: Array<ProductOptionGroupTranslationInput>;
};

export type CreateProductVariantInput = {
  assetIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  facetValueIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  featuredAssetId?: InputMaybe<Scalars['ID']['input']>;
  optionIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  outOfStockThreshold?: InputMaybe<Scalars['Int']['input']>;
  price?: InputMaybe<Scalars['Money']['input']>;
  prices?: InputMaybe<Array<InputMaybe<CreateProductVariantPriceInput>>>;
  productId: Scalars['ID']['input'];
  sku: Scalars['String']['input'];
  stockLevels?: InputMaybe<Array<StockLevelInput>>;
  stockOnHand?: InputMaybe<Scalars['Int']['input']>;
  taxCategoryId?: InputMaybe<Scalars['ID']['input']>;
  trackInventory?: InputMaybe<GlobalFlag>;
  translations: Array<ProductVariantTranslationInput>;
  useGlobalOutOfStockThreshold?: InputMaybe<Scalars['Boolean']['input']>;
};

export type CreateProductVariantOptionInput = {
  code: Scalars['String']['input'];
  optionGroupId: Scalars['ID']['input'];
  translations: Array<ProductOptionTranslationInput>;
};

export type CreateProductVariantPriceInput = {
  currencyCode: CurrencyCode;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  price: Scalars['Money']['input'];
};

export type CreatePromotionInput = {
  actions: Array<ConfigurableOperationInput>;
  conditions: Array<ConfigurableOperationInput>;
  couponCode?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  enabled: Scalars['Boolean']['input'];
  endsAt?: InputMaybe<Scalars['DateTime']['input']>;
  perCustomerUsageLimit?: InputMaybe<Scalars['Int']['input']>;
  startsAt?: InputMaybe<Scalars['DateTime']['input']>;
  translations: Array<PromotionTranslationInput>;
  usageLimit?: InputMaybe<Scalars['Int']['input']>;
};

export type CreatePromotionPlanInput = {
  analyticsTier: Scalars['String']['input'];
  code: Scalars['String']['input'];
  enabled: Scalars['Boolean']['input'];
  maxActiveCampaigns: Scalars['Int']['input'];
  maxBoostScore: Scalars['Int']['input'];
  maxDailyBudget?: InputMaybe<Scalars['Int']['input']>;
  name: Scalars['String']['input'];
};

export type CreatePromotionResult = MissingConditionsError | Promotion;

export type CreatePromotionTopupIntentInput = {
  amount: Scalars['Int']['input'];
  currencyCode: Scalars['String']['input'];
  idempotencyKey: Scalars['String']['input'];
};

export type CreateProvinceInput = {
  code: Scalars['String']['input'];
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  enabled: Scalars['Boolean']['input'];
  translations: Array<ProvinceTranslationInput>;
};

export type CreateRoleInput = {
  channelIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  code: Scalars['String']['input'];
  description: Scalars['String']['input'];
  permissions: Array<Permission>;
};

export type CreateSellerCashbackPolicyInput = {
  expiryDays: Scalars['Int']['input'];
  isActive: Scalars['Boolean']['input'];
  maxEarnPerOrderPaise?: InputMaybe<Scalars['Int']['input']>;
  maxRedemptionPct: Scalars['Int']['input'];
  minOrderAmountPaise: Scalars['Int']['input'];
  pendingDays: Scalars['Int']['input'];
  rateType: Scalars['String']['input'];
  rateValue: Scalars['Int']['input'];
  sellerId: Scalars['ID']['input'];
};

export type CreateSellerCategoryPolicyInput = {
  allowedCollectionIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  allowedFacetIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  blockedFacetValueIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  code: Scalars['String']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  moderationRules?: InputMaybe<Scalars['JSON']['input']>;
};

export type CreateSellerCustomFieldsInput = {
  deliveryRadiusKm?: InputMaybe<Scalars['Float']['input']>;
  isVerified?: InputMaybe<Scalars['Boolean']['input']>;
  onboardingStatus?: InputMaybe<Scalars['String']['input']>;
  operationalStatus?: InputMaybe<Scalars['String']['input']>;
  razorpayLinkedAccountId?: InputMaybe<Scalars['String']['input']>;
};

export type CreateSellerInput = {
  customFields?: InputMaybe<CreateSellerCustomFieldsInput>;
  emailAddress: Scalars['String']['input'];
  firstName: Scalars['String']['input'];
  lastName: Scalars['String']['input'];
  name: Scalars['String']['input'];
  password: Scalars['String']['input'];
  razorpayLinkedAccountId?: InputMaybe<Scalars['String']['input']>;
  shippingOverrides?: InputMaybe<ShippingDefaultsInput>;
};

export type CreateSellerPromotionInput = {
  bannerCtaLabel?: InputMaybe<Scalars['String']['input']>;
  bannerCtaUrl?: InputMaybe<Scalars['String']['input']>;
  bannerImageAssetId?: InputMaybe<Scalars['ID']['input']>;
  bannerSubtitle?: InputMaybe<Scalars['String']['input']>;
  bannerTitle?: InputMaybe<Scalars['String']['input']>;
  boostScore?: InputMaybe<Scalars['Int']['input']>;
  collectionIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  endAt: Scalars['DateTime']['input'];
  name: Scalars['String']['input'];
  startAt: Scalars['DateTime']['input'];
};

export type CreateShippingMethodInput = {
  calculator: ConfigurableOperationInput;
  checker: ConfigurableOperationInput;
  code: Scalars['String']['input'];
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  fulfillmentHandler: Scalars['String']['input'];
  translations: Array<ShippingMethodTranslationInput>;
};

export type CreateStockLocationCustomFieldsInput = {
  city?: InputMaybe<Scalars['String']['input']>;
  latitude?: InputMaybe<Scalars['Float']['input']>;
  longitude?: InputMaybe<Scalars['Float']['input']>;
  postalCode?: InputMaybe<Scalars['String']['input']>;
};

export type CreateStockLocationInput = {
  customFields?: InputMaybe<CreateStockLocationCustomFieldsInput>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
};

export type CreateTagInput = {
  value: Scalars['String']['input'];
};

export type CreateTaxCategoryInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
};

export type CreateTaxRateInput = {
  categoryId: Scalars['ID']['input'];
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  customerGroupId?: InputMaybe<Scalars['ID']['input']>;
  enabled: Scalars['Boolean']['input'];
  name: Scalars['String']['input'];
  value: Scalars['Float']['input'];
  zoneId: Scalars['ID']['input'];
};

export type CreateZoneInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  memberIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  name: Scalars['String']['input'];
};

/**
 * @description
 * ISO 4217 currency code
 *
 * @docsCategory common
 */
export type CurrencyCode =
  /** United Arab Emirates dirham */
  | 'AED'
  /** Afghan afghani */
  | 'AFN'
  /** Albanian lek */
  | 'ALL'
  /** Armenian dram */
  | 'AMD'
  /** Netherlands Antillean guilder */
  | 'ANG'
  /** Angolan kwanza */
  | 'AOA'
  /** Argentine peso */
  | 'ARS'
  /** Australian dollar */
  | 'AUD'
  /** Aruban florin */
  | 'AWG'
  /** Azerbaijani manat */
  | 'AZN'
  /** Bosnia and Herzegovina convertible mark */
  | 'BAM'
  /** Barbados dollar */
  | 'BBD'
  /** Bangladeshi taka */
  | 'BDT'
  /** Bulgarian lev */
  | 'BGN'
  /** Bahraini dinar */
  | 'BHD'
  /** Burundian franc */
  | 'BIF'
  /** Bermudian dollar */
  | 'BMD'
  /** Brunei dollar */
  | 'BND'
  /** Boliviano */
  | 'BOB'
  /** Brazilian real */
  | 'BRL'
  /** Bahamian dollar */
  | 'BSD'
  /** Bhutanese ngultrum */
  | 'BTN'
  /** Botswana pula */
  | 'BWP'
  /** Belarusian ruble */
  | 'BYN'
  /** Belize dollar */
  | 'BZD'
  /** Canadian dollar */
  | 'CAD'
  /** Congolese franc */
  | 'CDF'
  /** Swiss franc */
  | 'CHF'
  /** Chilean peso */
  | 'CLP'
  /** Renminbi (Chinese) yuan */
  | 'CNY'
  /** Colombian peso */
  | 'COP'
  /** Costa Rican colon */
  | 'CRC'
  /** Cuban convertible peso */
  | 'CUC'
  /** Cuban peso */
  | 'CUP'
  /** Cape Verde escudo */
  | 'CVE'
  /** Czech koruna */
  | 'CZK'
  /** Djiboutian franc */
  | 'DJF'
  /** Danish krone */
  | 'DKK'
  /** Dominican peso */
  | 'DOP'
  /** Algerian dinar */
  | 'DZD'
  /** Egyptian pound */
  | 'EGP'
  /** Eritrean nakfa */
  | 'ERN'
  /** Ethiopian birr */
  | 'ETB'
  /** Euro */
  | 'EUR'
  /** Fiji dollar */
  | 'FJD'
  /** Falkland Islands pound */
  | 'FKP'
  /** Pound sterling */
  | 'GBP'
  /** Georgian lari */
  | 'GEL'
  /** Ghanaian cedi */
  | 'GHS'
  /** Gibraltar pound */
  | 'GIP'
  /** Gambian dalasi */
  | 'GMD'
  /** Guinean franc */
  | 'GNF'
  /** Guatemalan quetzal */
  | 'GTQ'
  /** Guyanese dollar */
  | 'GYD'
  /** Hong Kong dollar */
  | 'HKD'
  /** Honduran lempira */
  | 'HNL'
  /** Croatian kuna */
  | 'HRK'
  /** Haitian gourde */
  | 'HTG'
  /** Hungarian forint */
  | 'HUF'
  /** Indonesian rupiah */
  | 'IDR'
  /** Israeli new shekel */
  | 'ILS'
  /** Indian rupee */
  | 'INR'
  /** Iraqi dinar */
  | 'IQD'
  /** Iranian rial */
  | 'IRR'
  /** Icelandic króna */
  | 'ISK'
  /** Jamaican dollar */
  | 'JMD'
  /** Jordanian dinar */
  | 'JOD'
  /** Japanese yen */
  | 'JPY'
  /** Kenyan shilling */
  | 'KES'
  /** Kyrgyzstani som */
  | 'KGS'
  /** Cambodian riel */
  | 'KHR'
  /** Comoro franc */
  | 'KMF'
  /** North Korean won */
  | 'KPW'
  /** South Korean won */
  | 'KRW'
  /** Kuwaiti dinar */
  | 'KWD'
  /** Cayman Islands dollar */
  | 'KYD'
  /** Kazakhstani tenge */
  | 'KZT'
  /** Lao kip */
  | 'LAK'
  /** Lebanese pound */
  | 'LBP'
  /** Sri Lankan rupee */
  | 'LKR'
  /** Liberian dollar */
  | 'LRD'
  /** Lesotho loti */
  | 'LSL'
  /** Libyan dinar */
  | 'LYD'
  /** Moroccan dirham */
  | 'MAD'
  /** Moldovan leu */
  | 'MDL'
  /** Malagasy ariary */
  | 'MGA'
  /** Macedonian denar */
  | 'MKD'
  /** Myanmar kyat */
  | 'MMK'
  /** Mongolian tögrög */
  | 'MNT'
  /** Macanese pataca */
  | 'MOP'
  /** Mauritanian ouguiya */
  | 'MRU'
  /** Mauritian rupee */
  | 'MUR'
  /** Maldivian rufiyaa */
  | 'MVR'
  /** Malawian kwacha */
  | 'MWK'
  /** Mexican peso */
  | 'MXN'
  /** Malaysian ringgit */
  | 'MYR'
  /** Mozambican metical */
  | 'MZN'
  /** Namibian dollar */
  | 'NAD'
  /** Nigerian naira */
  | 'NGN'
  /** Nicaraguan córdoba */
  | 'NIO'
  /** Norwegian krone */
  | 'NOK'
  /** Nepalese rupee */
  | 'NPR'
  /** New Zealand dollar */
  | 'NZD'
  /** Omani rial */
  | 'OMR'
  /** Panamanian balboa */
  | 'PAB'
  /** Peruvian sol */
  | 'PEN'
  /** Papua New Guinean kina */
  | 'PGK'
  /** Philippine peso */
  | 'PHP'
  /** Pakistani rupee */
  | 'PKR'
  /** Polish złoty */
  | 'PLN'
  /** Paraguayan guaraní */
  | 'PYG'
  /** Qatari riyal */
  | 'QAR'
  /** Romanian leu */
  | 'RON'
  /** Serbian dinar */
  | 'RSD'
  /** Russian ruble */
  | 'RUB'
  /** Rwandan franc */
  | 'RWF'
  /** Saudi riyal */
  | 'SAR'
  /** Solomon Islands dollar */
  | 'SBD'
  /** Seychelles rupee */
  | 'SCR'
  /** Sudanese pound */
  | 'SDG'
  /** Swedish krona/kronor */
  | 'SEK'
  /** Singapore dollar */
  | 'SGD'
  /** Saint Helena pound */
  | 'SHP'
  /** Sierra Leonean leone */
  | 'SLL'
  /** Somali shilling */
  | 'SOS'
  /** Surinamese dollar */
  | 'SRD'
  /** South Sudanese pound */
  | 'SSP'
  /** São Tomé and Príncipe dobra */
  | 'STN'
  /** Salvadoran colón */
  | 'SVC'
  /** Syrian pound */
  | 'SYP'
  /** Swazi lilangeni */
  | 'SZL'
  /** Thai baht */
  | 'THB'
  /** Tajikistani somoni */
  | 'TJS'
  /** Turkmenistan manat */
  | 'TMT'
  /** Tunisian dinar */
  | 'TND'
  /** Tongan paʻanga */
  | 'TOP'
  /** Turkish lira */
  | 'TRY'
  /** Trinidad and Tobago dollar */
  | 'TTD'
  /** New Taiwan dollar */
  | 'TWD'
  /** Tanzanian shilling */
  | 'TZS'
  /** Ukrainian hryvnia */
  | 'UAH'
  /** Ugandan shilling */
  | 'UGX'
  /** United States dollar */
  | 'USD'
  /** Uruguayan peso */
  | 'UYU'
  /** Uzbekistan som */
  | 'UZS'
  /** Venezuelan bolívar soberano */
  | 'VES'
  /** Vietnamese đồng */
  | 'VND'
  /** Vanuatu vatu */
  | 'VUV'
  /** Samoan tala */
  | 'WST'
  /** CFA franc BEAC */
  | 'XAF'
  /** East Caribbean dollar */
  | 'XCD'
  /** CFA franc BCEAO */
  | 'XOF'
  /** CFP franc (franc Pacifique) */
  | 'XPF'
  /** Yemeni rial */
  | 'YER'
  /** South African rand */
  | 'ZAR'
  /** Zambian kwacha */
  | 'ZMW'
  /** Zimbabwean dollar */
  | 'ZWL';

export type CurrentUser = {
  channels: Array<CurrentUserChannel>;
  id: Scalars['ID']['output'];
  identifier: Scalars['String']['output'];
};

export type CurrentUserChannel = {
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  permissions: Array<Permission>;
  token: Scalars['String']['output'];
};

export type CustomField = {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type CustomFieldConfig = BooleanCustomFieldConfig | DateTimeCustomFieldConfig | FloatCustomFieldConfig | IntCustomFieldConfig | LocaleStringCustomFieldConfig | LocaleTextCustomFieldConfig | RelationCustomFieldConfig | StringCustomFieldConfig | StructCustomFieldConfig | TextCustomFieldConfig;

/**
 * This type is deprecated in v2.2 in favor of the EntityCustomFields type,
 * which allows custom fields to be defined on user-supplied entities.
 */
export type CustomFields = {
  Address: Array<CustomFieldConfig>;
  Administrator: Array<CustomFieldConfig>;
  Asset: Array<CustomFieldConfig>;
  Channel: Array<CustomFieldConfig>;
  Collection: Array<CustomFieldConfig>;
  Customer: Array<CustomFieldConfig>;
  CustomerGroup: Array<CustomFieldConfig>;
  Facet: Array<CustomFieldConfig>;
  FacetValue: Array<CustomFieldConfig>;
  Fulfillment: Array<CustomFieldConfig>;
  GlobalSettings: Array<CustomFieldConfig>;
  HistoryEntry: Array<CustomFieldConfig>;
  Order: Array<CustomFieldConfig>;
  OrderLine: Array<CustomFieldConfig>;
  Payment: Array<CustomFieldConfig>;
  PaymentMethod: Array<CustomFieldConfig>;
  Product: Array<CustomFieldConfig>;
  ProductOption: Array<CustomFieldConfig>;
  ProductOptionGroup: Array<CustomFieldConfig>;
  ProductVariant: Array<CustomFieldConfig>;
  ProductVariantPrice: Array<CustomFieldConfig>;
  Promotion: Array<CustomFieldConfig>;
  Refund: Array<CustomFieldConfig>;
  Region: Array<CustomFieldConfig>;
  Seller: Array<CustomFieldConfig>;
  Session: Array<CustomFieldConfig>;
  ShippingLine: Array<CustomFieldConfig>;
  ShippingMethod: Array<CustomFieldConfig>;
  StockLevel: Array<CustomFieldConfig>;
  StockLocation: Array<CustomFieldConfig>;
  StockMovement: Array<CustomFieldConfig>;
  TaxCategory: Array<CustomFieldConfig>;
  TaxRate: Array<CustomFieldConfig>;
  User: Array<CustomFieldConfig>;
  Zone: Array<CustomFieldConfig>;
};

export type CustomProductScriptFields = {
  haversineDistanceKm?: Maybe<Scalars['Float']['output']>;
  isBeyondDeliveryRadius?: Maybe<Scalars['Boolean']['output']>;
};

export type CustomProductVariantMappings = {
  deliveryThreshold?: Maybe<Scalars['String']['output']>;
  isFastPossible: Scalars['Boolean']['output'];
};

export type CustomProductVariantScriptFields = {
  haversineDistanceKm?: Maybe<Scalars['Float']['output']>;
  isBeyondDeliveryRadius?: Maybe<Scalars['Boolean']['output']>;
};

export type CustomScriptFields = CustomProductScriptFields | CustomProductVariantScriptFields;

export type Customer = Node & {
  addresses?: Maybe<Array<Address>>;
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  emailAddress: Scalars['String']['output'];
  firstName: Scalars['String']['output'];
  groups: Array<CustomerGroup>;
  history: HistoryEntryList;
  id: Scalars['ID']['output'];
  lastName: Scalars['String']['output'];
  orders: OrderList;
  phoneNumber?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  user?: Maybe<User>;
};


export type CustomerHistoryArgs = {
  options?: InputMaybe<HistoryEntryListOptions>;
};


export type CustomerOrdersArgs = {
  options?: InputMaybe<OrderListOptions>;
};

export type CustomerCashbackWallet = {
  availableBalance: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  customerId: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  lifetimeEarned: Scalars['Int']['output'];
  lifetimeExpired: Scalars['Int']['output'];
  lifetimeRedeemed: Scalars['Int']['output'];
  pendingBalance: Scalars['Int']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type CustomerFilterParameter = {
  _and?: InputMaybe<Array<CustomerFilterParameter>>;
  _or?: InputMaybe<Array<CustomerFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  emailAddress?: InputMaybe<StringOperators>;
  firstName?: InputMaybe<StringOperators>;
  id?: InputMaybe<IdOperators>;
  lastName?: InputMaybe<StringOperators>;
  phoneNumber?: InputMaybe<StringOperators>;
  postalCode?: InputMaybe<StringOperators>;
  title?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type CustomerGroup = Node & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  customers: CustomerList;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};


export type CustomerGroupCustomersArgs = {
  options?: InputMaybe<CustomerListOptions>;
};

export type CustomerGroupFilterParameter = {
  _and?: InputMaybe<Array<CustomerGroupFilterParameter>>;
  _or?: InputMaybe<Array<CustomerGroupFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  id?: InputMaybe<IdOperators>;
  name?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type CustomerGroupList = PaginatedList & {
  items: Array<CustomerGroup>;
  totalItems: Scalars['Int']['output'];
};

export type CustomerGroupListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<CustomerGroupFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<CustomerGroupSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type CustomerGroupSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type CustomerList = PaginatedList & {
  items: Array<Customer>;
  totalItems: Scalars['Int']['output'];
};

export type CustomerListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<CustomerFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<CustomerSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type CustomerLocationContext = {
  addressText?: Maybe<Scalars['String']['output']>;
  city?: Maybe<Scalars['String']['output']>;
  lat: Scalars['Float']['output'];
  locality?: Maybe<Scalars['String']['output']>;
  lon: Scalars['Float']['output'];
  postalCode?: Maybe<Scalars['String']['output']>;
  source: Scalars['String']['output'];
  validatedAt: Scalars['String']['output'];
};

export type CustomerSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  emailAddress?: InputMaybe<SortOrder>;
  firstName?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  lastName?: InputMaybe<SortOrder>;
  phoneNumber?: InputMaybe<SortOrder>;
  title?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type DashboardPeriod =
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_MONTH'
  | 'THIS_MONTH';

/** Operators for filtering on a list of Date fields */
export type DateListOperators = {
  inList: Scalars['DateTime']['input'];
};

/** Operators for filtering on a DateTime field */
export type DateOperators = {
  after?: InputMaybe<Scalars['DateTime']['input']>;
  before?: InputMaybe<Scalars['DateTime']['input']>;
  between?: InputMaybe<DateRange>;
  eq?: InputMaybe<Scalars['DateTime']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
};

export type DateRange = {
  end: Scalars['DateTime']['input'];
  start: Scalars['DateTime']['input'];
};

/**
 * Expects the same validation formats as the `<input type="datetime-local">` HTML element.
 * See https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/datetime-local#Additional_attributes
 */
export type DateTimeCustomFieldConfig = CustomField & {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  max?: Maybe<Scalars['String']['output']>;
  min?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  step?: Maybe<Scalars['Int']['output']>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

/**
 * Expects the same validation formats as the `<input type="datetime-local">` HTML element.
 * See https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/datetime-local#Additional_attributes
 */
export type DateTimeStructFieldConfig = StructField & {
  description?: Maybe<Array<LocalizedString>>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  max?: Maybe<Scalars['String']['output']>;
  min?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  step?: Maybe<Scalars['Int']['output']>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type DeleteAssetInput = {
  assetId: Scalars['ID']['input'];
  deleteFromAllChannels?: InputMaybe<Scalars['Boolean']['input']>;
  force?: InputMaybe<Scalars['Boolean']['input']>;
};

export type DeleteAssetsInput = {
  assetIds: Array<Scalars['ID']['input']>;
  deleteFromAllChannels?: InputMaybe<Scalars['Boolean']['input']>;
  force?: InputMaybe<Scalars['Boolean']['input']>;
};

export type DeleteStockLocationInput = {
  id: Scalars['ID']['input'];
  transferToLocationId?: InputMaybe<Scalars['ID']['input']>;
};

export type DeletionResponse = {
  message?: Maybe<Scalars['String']['output']>;
  result: DeletionResult;
};

export type DeletionResult =
  /** The entity was successfully deleted */
  | 'DELETED'
  /** Deletion did not take place, reason given in message */
  | 'NOT_DELETED';

export type DeliveryAssignmentList = PaginatedList & {
  items: Array<DeliveryAssignmentRecord>;
  totalItems: Scalars['Int']['output'];
};

export type DeliveryAssignmentRecord = Node & {
  assignedAt?: Maybe<Scalars['DateTime']['output']>;
  channelId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  deliveredAt?: Maybe<Scalars['DateTime']['output']>;
  deliveryProofUrl?: Maybe<Scalars['String']['output']>;
  driverId?: Maybe<Scalars['String']['output']>;
  dropLat?: Maybe<Scalars['Float']['output']>;
  dropLon?: Maybe<Scalars['Float']['output']>;
  externalAssignmentId?: Maybe<Scalars['String']['output']>;
  failedAt?: Maybe<Scalars['DateTime']['output']>;
  failureCode?: Maybe<Scalars['String']['output']>;
  failureReason?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  pickedUpAt?: Maybe<Scalars['DateTime']['output']>;
  pickupLat?: Maybe<Scalars['Float']['output']>;
  pickupLon?: Maybe<Scalars['Float']['output']>;
  pickupProofUrl?: Maybe<Scalars['String']['output']>;
  reconciliationStatus?: Maybe<Scalars['String']['output']>;
  retryCount: Scalars['Int']['output'];
  sellerOrderId: Scalars['ID']['output'];
  status: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type DeliveryAvgDurations = {
  assignToPickupSeconds: Scalars['Float']['output'];
  dispatchToAssignSeconds: Scalars['Float']['output'];
  pickupToDeliverSeconds: Scalars['Float']['output'];
  totalSeconds: Scalars['Float']['output'];
};

export type DeliveryStatsResult = {
  ASSIGNED: Scalars['Int']['output'];
  DELIVERED: Scalars['Int']['output'];
  DISPATCHING: Scalars['Int']['output'];
  FAILED: Scalars['Int']['output'];
  PENDING: Scalars['Int']['output'];
  PICKED_UP: Scalars['Int']['output'];
  avgDurations: DeliveryAvgDurations;
  byStatus: DeliveryStatusCounts;
  onTime: Scalars['Int']['output'];
  pending: Scalars['Int']['output'];
  slaBreachRate: Scalars['Float']['output'];
  slaBreached: Scalars['Int']['output'];
};

export type DeliveryStatusCounts = {
  ASSIGNED: Scalars['Int']['output'];
  CANCELLED: Scalars['Int']['output'];
  DELIVERED: Scalars['Int']['output'];
  FAILED: Scalars['Int']['output'];
  IN_TRANSIT: Scalars['Int']['output'];
  PENDING: Scalars['Int']['output'];
  PICKED_UP: Scalars['Int']['output'];
};

export type Discount = {
  adjustmentSource: Scalars['String']['output'];
  amount: Scalars['Money']['output'];
  amountWithTax: Scalars['Money']['output'];
  description: Scalars['String']['output'];
  type: AdjustmentType;
};

export type DuplicateEntityError = ErrorResult & {
  duplicationError: Scalars['String']['output'];
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type DuplicateEntityInput = {
  duplicatorInput: ConfigurableOperationInput;
  entityId: Scalars['ID']['input'];
  entityName: Scalars['String']['input'];
};

export type DuplicateEntityResult = DuplicateEntityError | DuplicateEntitySuccess;

export type DuplicateEntitySuccess = {
  newEntityId: Scalars['ID']['output'];
};

/** Returned when attempting to create a Customer with an email address already registered to an existing User. */
export type EmailAddressConflictError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/** Returned if no OrderLines have been specified for the operation */
export type EmptyOrderLineSelectionError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type EntityCustomFields = {
  customFields: Array<CustomFieldConfig>;
  entityName: Scalars['String']['output'];
};

export type EntityDuplicatorDefinition = {
  args: Array<ConfigArgDefinition>;
  code: Scalars['String']['output'];
  description: Scalars['String']['output'];
  forEntities: Array<Scalars['String']['output']>;
  requiresPermission: Array<Permission>;
};

export type ErrorCode =
  | 'ALREADY_REFUNDED_ERROR'
  | 'CANCEL_ACTIVE_ORDER_ERROR'
  | 'CANCEL_PAYMENT_ERROR'
  | 'CHANNEL_DEFAULT_LANGUAGE_ERROR'
  | 'COUPON_CODE_EXPIRED_ERROR'
  | 'COUPON_CODE_INVALID_ERROR'
  | 'COUPON_CODE_LIMIT_ERROR'
  | 'CREATE_FULFILLMENT_ERROR'
  | 'DUPLICATE_ENTITY_ERROR'
  | 'EMAIL_ADDRESS_CONFLICT_ERROR'
  | 'EMPTY_ORDER_LINE_SELECTION_ERROR'
  | 'FACET_IN_USE_ERROR'
  | 'FULFILLMENT_STATE_TRANSITION_ERROR'
  | 'GUEST_CHECKOUT_ERROR'
  | 'INELIGIBLE_SHIPPING_METHOD_ERROR'
  | 'INSUFFICIENT_STOCK_ERROR'
  | 'INSUFFICIENT_STOCK_ON_HAND_ERROR'
  | 'INVALID_CREDENTIALS_ERROR'
  | 'INVALID_FULFILLMENT_HANDLER_ERROR'
  | 'ITEMS_ALREADY_FULFILLED_ERROR'
  | 'LANGUAGE_NOT_AVAILABLE_ERROR'
  | 'MANUAL_PAYMENT_STATE_ERROR'
  | 'MIME_TYPE_ERROR'
  | 'MISSING_CONDITIONS_ERROR'
  | 'MULTIPLE_ORDER_ERROR'
  | 'NATIVE_AUTH_STRATEGY_ERROR'
  | 'NEGATIVE_QUANTITY_ERROR'
  | 'NOTHING_TO_REFUND_ERROR'
  | 'NO_ACTIVE_ORDER_ERROR'
  | 'NO_CHANGES_SPECIFIED_ERROR'
  | 'ORDER_INTERCEPTOR_ERROR'
  | 'ORDER_LIMIT_ERROR'
  | 'ORDER_MODIFICATION_ERROR'
  | 'ORDER_MODIFICATION_STATE_ERROR'
  | 'ORDER_STATE_TRANSITION_ERROR'
  | 'PAYMENT_METHOD_MISSING_ERROR'
  | 'PAYMENT_ORDER_MISMATCH_ERROR'
  | 'PAYMENT_STATE_TRANSITION_ERROR'
  | 'PRODUCT_OPTION_IN_USE_ERROR'
  | 'QUANTITY_TOO_GREAT_ERROR'
  | 'REFUND_AMOUNT_ERROR'
  | 'REFUND_ORDER_STATE_ERROR'
  | 'REFUND_PAYMENT_ID_MISSING_ERROR'
  | 'REFUND_STATE_TRANSITION_ERROR'
  | 'SETTLE_PAYMENT_ERROR'
  | 'UNKNOWN_ERROR';

export type ErrorResult = {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type Facet = Node & {
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  isPrivate: Scalars['Boolean']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  translations: Array<FacetTranslation>;
  updatedAt: Scalars['DateTime']['output'];
  /** Returns a paginated, sortable, filterable list of the Facet's values. Added in v2.1.0. */
  valueList: FacetValueList;
  values: Array<FacetValue>;
};


export type FacetValueListArgs = {
  options?: InputMaybe<FacetValueListOptions>;
};

export type FacetFilterParameter = {
  _and?: InputMaybe<Array<FacetFilterParameter>>;
  _or?: InputMaybe<Array<FacetFilterParameter>>;
  code?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  id?: InputMaybe<IdOperators>;
  isPrivate?: InputMaybe<BooleanOperators>;
  languageCode?: InputMaybe<StringOperators>;
  name?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type FacetInUseError = ErrorResult & {
  errorCode: ErrorCode;
  facetCode: Scalars['String']['output'];
  message: Scalars['String']['output'];
  productCount: Scalars['Int']['output'];
  variantCount: Scalars['Int']['output'];
};

export type FacetList = PaginatedList & {
  items: Array<Facet>;
  totalItems: Scalars['Int']['output'];
};

export type FacetListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<FacetFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<FacetSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type FacetSortParameter = {
  code?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type FacetTranslation = {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type FacetTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type FacetValue = Node & {
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  facet: Facet;
  facetId: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  translations: Array<FacetValueTranslation>;
  updatedAt: Scalars['DateTime']['output'];
};

/**
 * Used to construct boolean expressions for filtering search results
 * by FacetValue ID. Examples:
 *
 * * ID=1 OR ID=2: `{ facetValueFilters: [{ or: [1,2] }] }`
 * * ID=1 AND ID=2: `{ facetValueFilters: [{ and: 1 }, { and: 2 }] }`
 * * ID=1 AND (ID=2 OR ID=3): `{ facetValueFilters: [{ and: 1 }, { or: [2,3] }] }`
 */
export type FacetValueFilterInput = {
  and?: InputMaybe<Scalars['ID']['input']>;
  or?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type FacetValueFilterParameter = {
  _and?: InputMaybe<Array<FacetValueFilterParameter>>;
  _or?: InputMaybe<Array<FacetValueFilterParameter>>;
  code?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  facetId?: InputMaybe<IdOperators>;
  id?: InputMaybe<IdOperators>;
  languageCode?: InputMaybe<StringOperators>;
  name?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type FacetValueList = PaginatedList & {
  items: Array<FacetValue>;
  totalItems: Scalars['Int']['output'];
};

export type FacetValueListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<FacetValueFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<FacetValueSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

/**
 * Which FacetValues are present in the products returned
 * by the search, and in what quantity.
 */
export type FacetValueResult = {
  count: Scalars['Int']['output'];
  facetValue: FacetValue;
};

export type FacetValueSortParameter = {
  code?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  facetId?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type FacetValueTranslation = {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type FacetValueTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type FloatCustomFieldConfig = CustomField & {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  max?: Maybe<Scalars['Float']['output']>;
  min?: Maybe<Scalars['Float']['output']>;
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  step?: Maybe<Scalars['Float']['output']>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type FloatStructFieldConfig = StructField & {
  description?: Maybe<Array<LocalizedString>>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  max?: Maybe<Scalars['Float']['output']>;
  min?: Maybe<Scalars['Float']['output']>;
  name: Scalars['String']['output'];
  step?: Maybe<Scalars['Float']['output']>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type FulfillOrderInput = {
  handler: ConfigurableOperationInput;
  lines: Array<OrderLineInput>;
};

export type Fulfillment = Node & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  lines: Array<FulfillmentLine>;
  method: Scalars['String']['output'];
  nextStates: Array<Scalars['String']['output']>;
  state: Scalars['String']['output'];
  /** @deprecated Use the `lines` field instead */
  summary: Array<FulfillmentLine>;
  trackingCode?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type FulfillmentLine = {
  fulfillment: Fulfillment;
  fulfillmentId: Scalars['ID']['output'];
  orderLine: OrderLine;
  orderLineId: Scalars['ID']['output'];
  quantity: Scalars['Int']['output'];
};

/** Returned when there is an error in transitioning the Fulfillment state */
export type FulfillmentStateTransitionError = ErrorResult & {
  errorCode: ErrorCode;
  fromState: Scalars['String']['output'];
  message: Scalars['String']['output'];
  toState: Scalars['String']['output'];
  transitionError: Scalars['String']['output'];
};

export type GeoCacheHealthStats = {
  cacheHitRate: Scalars['Float']['output'];
  heapTotal: Scalars['String']['output'];
  heapUsed: Scalars['String']['output'];
  totalRequests: Scalars['Int']['output'];
};

export type GeoCacheMemoryStats = {
  maxSize: Scalars['Int']['output'];
  size: Scalars['Int']['output'];
  ttlMs: Scalars['Int']['output'];
};

export type GeoCacheRedisStats = {
  connected: Scalars['Boolean']['output'];
  prefix: Scalars['String']['output'];
  ttlSeconds: Scalars['Int']['output'];
};

export type GeoCacheRequestStats = {
  geocodingRequests: Scalars['Int']['output'];
  memoryHits: Scalars['Int']['output'];
  memoryMisses: Scalars['Int']['output'];
  redisHits: Scalars['Int']['output'];
  redisMisses: Scalars['Int']['output'];
};

export type GeoCacheStats = {
  health?: Maybe<GeoCacheHealthStats>;
  memory: GeoCacheMemoryStats;
  redis: GeoCacheRedisStats;
  stats: GeoCacheRequestStats;
};

export type GeoCoordinates = {
  lat: Scalars['Float']['output'];
  lon: Scalars['Float']['output'];
};

export type GeoMetrics = {
  lifecycle_rejections_total: Scalars['Int']['output'];
  radius_rejections_total: Scalars['Int']['output'];
  search_reindex_events_total: Scalars['Int']['output'];
  search_reindex_failures_total: Scalars['Int']['output'];
  search_sync_latency_ms: Scalars['Int']['output'];
  successful_orders_within_radius: Scalars['Int']['output'];
};

export type GlobalFlag =
  | 'FALSE'
  | 'INHERIT'
  | 'TRUE';

export type GlobalSettings = {
  availableLanguages: Array<LanguageCode>;
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  outOfStockThreshold: Scalars['Int']['output'];
  serverConfig: ServerConfig;
  trackInventory: Scalars['Boolean']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

/** Returned when attempting to set the Customer on a guest checkout when the configured GuestCheckoutStrategy does not allow it. */
export type GuestCheckoutError = ErrorResult & {
  errorCode: ErrorCode;
  errorDetail: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

export type HistoryEntry = Node & {
  administrator?: Maybe<Administrator>;
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  data: Scalars['JSON']['output'];
  id: Scalars['ID']['output'];
  isPublic: Scalars['Boolean']['output'];
  type: HistoryEntryType;
  updatedAt: Scalars['DateTime']['output'];
};

export type HistoryEntryFilterParameter = {
  _and?: InputMaybe<Array<HistoryEntryFilterParameter>>;
  _or?: InputMaybe<Array<HistoryEntryFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  id?: InputMaybe<IdOperators>;
  isPublic?: InputMaybe<BooleanOperators>;
  type?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type HistoryEntryList = PaginatedList & {
  items: Array<HistoryEntry>;
  totalItems: Scalars['Int']['output'];
};

export type HistoryEntryListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<HistoryEntryFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<HistoryEntrySortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type HistoryEntrySortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type HistoryEntryType =
  | 'CUSTOMER_ADDED_TO_GROUP'
  | 'CUSTOMER_ADDRESS_CREATED'
  | 'CUSTOMER_ADDRESS_DELETED'
  | 'CUSTOMER_ADDRESS_UPDATED'
  | 'CUSTOMER_DETAIL_UPDATED'
  | 'CUSTOMER_EMAIL_UPDATE_REQUESTED'
  | 'CUSTOMER_EMAIL_UPDATE_VERIFIED'
  | 'CUSTOMER_NOTE'
  | 'CUSTOMER_PASSWORD_RESET_REQUESTED'
  | 'CUSTOMER_PASSWORD_RESET_VERIFIED'
  | 'CUSTOMER_PASSWORD_UPDATED'
  | 'CUSTOMER_REGISTERED'
  | 'CUSTOMER_REMOVED_FROM_GROUP'
  | 'CUSTOMER_VERIFIED'
  | 'ORDER_CANCELLATION'
  | 'ORDER_COUPON_APPLIED'
  | 'ORDER_COUPON_REMOVED'
  | 'ORDER_CUSTOMER_UPDATED'
  | 'ORDER_FULFILLMENT'
  | 'ORDER_FULFILLMENT_TRANSITION'
  | 'ORDER_MODIFIED'
  | 'ORDER_NOTE'
  | 'ORDER_PAYMENT_TRANSITION'
  | 'ORDER_REFUND_TRANSITION'
  | 'ORDER_STATE_TRANSITION';

/** Operators for filtering on a list of ID fields */
export type IdListOperators = {
  inList: Scalars['ID']['input'];
};

/** Operators for filtering on an ID field */
export type IdOperators = {
  eq?: InputMaybe<Scalars['String']['input']>;
  in?: InputMaybe<Array<Scalars['String']['input']>>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  notEq?: InputMaybe<Scalars['String']['input']>;
  notIn?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type ImportInfo = {
  errors?: Maybe<Array<Scalars['String']['output']>>;
  imported: Scalars['Int']['output'];
  processed: Scalars['Int']['output'];
};

/** Returned when attempting to set a ShippingMethod for which the Order is not eligible */
export type IneligibleShippingMethodError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/** Returned when attempting to add more items to the Order than are available */
export type InsufficientStockError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
  order: Order;
  quantityAvailable: Scalars['Int']['output'];
};

/**
 * Returned if attempting to create a Fulfillment when there is insufficient
 * stockOnHand of a ProductVariant to satisfy the requested quantity.
 */
export type InsufficientStockOnHandError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
  productVariantId: Scalars['ID']['output'];
  productVariantName: Scalars['String']['output'];
  stockOnHand: Scalars['Int']['output'];
};

export type IntCustomFieldConfig = CustomField & {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  max?: Maybe<Scalars['Int']['output']>;
  min?: Maybe<Scalars['Int']['output']>;
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  step?: Maybe<Scalars['Int']['output']>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type IntStructFieldConfig = StructField & {
  description?: Maybe<Array<LocalizedString>>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  max?: Maybe<Scalars['Int']['output']>;
  min?: Maybe<Scalars['Int']['output']>;
  name: Scalars['String']['output'];
  step?: Maybe<Scalars['Int']['output']>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

/** Returned if the user authentication credentials are not valid */
export type InvalidCredentialsError = ErrorResult & {
  authenticationError: Scalars['String']['output'];
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/** Returned if the specified FulfillmentHandler code is not valid */
export type InvalidFulfillmentHandlerError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/** Returned if the specified items are already part of a Fulfillment */
export type ItemsAlreadyFulfilledError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type Job = Node & {
  attempts: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  data?: Maybe<Scalars['JSON']['output']>;
  duration: Scalars['Int']['output'];
  error?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  isSettled: Scalars['Boolean']['output'];
  progress: Scalars['Float']['output'];
  queueName: Scalars['String']['output'];
  result?: Maybe<Scalars['JSON']['output']>;
  retries: Scalars['Int']['output'];
  settledAt?: Maybe<Scalars['DateTime']['output']>;
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  state: JobState;
};

export type JobBufferSize = {
  bufferId: Scalars['String']['output'];
  size: Scalars['Int']['output'];
};

export type JobFilterParameter = {
  _and?: InputMaybe<Array<JobFilterParameter>>;
  _or?: InputMaybe<Array<JobFilterParameter>>;
  attempts?: InputMaybe<NumberOperators>;
  createdAt?: InputMaybe<DateOperators>;
  duration?: InputMaybe<NumberOperators>;
  id?: InputMaybe<IdOperators>;
  isSettled?: InputMaybe<BooleanOperators>;
  progress?: InputMaybe<NumberOperators>;
  queueName?: InputMaybe<StringOperators>;
  retries?: InputMaybe<NumberOperators>;
  settledAt?: InputMaybe<DateOperators>;
  startedAt?: InputMaybe<DateOperators>;
  state?: InputMaybe<StringOperators>;
};

export type JobList = PaginatedList & {
  items: Array<Job>;
  totalItems: Scalars['Int']['output'];
};

export type JobListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<JobFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<JobSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type JobQueue = {
  name: Scalars['String']['output'];
  running: Scalars['Boolean']['output'];
};

export type JobSortParameter = {
  attempts?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  duration?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  progress?: InputMaybe<SortOrder>;
  queueName?: InputMaybe<SortOrder>;
  retries?: InputMaybe<SortOrder>;
  settledAt?: InputMaybe<SortOrder>;
  startedAt?: InputMaybe<SortOrder>;
};

/**
 * @description
 * The state of a Job in the JobQueue
 *
 * @docsCategory common
 */
export type JobState =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'FAILED'
  | 'PENDING'
  | 'RETRYING'
  | 'RUNNING';

/**
 * @description
 * Languages in the form of a ISO 639-1 language code with optional
 * region or script modifier (e.g. de_AT). The selection available is based
 * on the [Unicode CLDR summary list](https://unicode-org.github.io/cldr-staging/charts/37/summary/root.html)
 * and includes the major spoken languages of the world and any widely-used variants.
 *
 * @docsCategory common
 */
export type LanguageCode =
  /** Afrikaans */
  | 'af'
  /** Akan */
  | 'ak'
  /** Amharic */
  | 'am'
  /** Arabic */
  | 'ar'
  /** Assamese */
  | 'as'
  /** Azerbaijani */
  | 'az'
  /** Belarusian */
  | 'be'
  /** Bulgarian */
  | 'bg'
  /** Bambara */
  | 'bm'
  /** Bangla */
  | 'bn'
  /** Tibetan */
  | 'bo'
  /** Breton */
  | 'br'
  /** Bosnian */
  | 'bs'
  /** Catalan */
  | 'ca'
  /** Chechen */
  | 'ce'
  /** Corsican */
  | 'co'
  /** Czech */
  | 'cs'
  /** Church Slavic */
  | 'cu'
  /** Welsh */
  | 'cy'
  /** Danish */
  | 'da'
  /** German */
  | 'de'
  /** Austrian German */
  | 'de_AT'
  /** Swiss High German */
  | 'de_CH'
  /** Dzongkha */
  | 'dz'
  /** Ewe */
  | 'ee'
  /** Greek */
  | 'el'
  /** English */
  | 'en'
  /** Australian English */
  | 'en_AU'
  /** Canadian English */
  | 'en_CA'
  /** British English */
  | 'en_GB'
  /** American English */
  | 'en_US'
  /** Esperanto */
  | 'eo'
  /** Spanish */
  | 'es'
  /** European Spanish */
  | 'es_ES'
  /** Mexican Spanish */
  | 'es_MX'
  /** Estonian */
  | 'et'
  /** Basque */
  | 'eu'
  /** Persian */
  | 'fa'
  /** Dari */
  | 'fa_AF'
  /** Fulah */
  | 'ff'
  /** Finnish */
  | 'fi'
  /** Faroese */
  | 'fo'
  /** French */
  | 'fr'
  /** Canadian French */
  | 'fr_CA'
  /** Swiss French */
  | 'fr_CH'
  /** Western Frisian */
  | 'fy'
  /** Irish */
  | 'ga'
  /** Scottish Gaelic */
  | 'gd'
  /** Galician */
  | 'gl'
  /** Gujarati */
  | 'gu'
  /** Manx */
  | 'gv'
  /** Hausa */
  | 'ha'
  /** Hebrew */
  | 'he'
  /** Hindi */
  | 'hi'
  /** Croatian */
  | 'hr'
  /** Haitian Creole */
  | 'ht'
  /** Hungarian */
  | 'hu'
  /** Armenian */
  | 'hy'
  /** Interlingua */
  | 'ia'
  /** Indonesian */
  | 'id'
  /** Igbo */
  | 'ig'
  /** Sichuan Yi */
  | 'ii'
  /** Icelandic */
  | 'is'
  /** Italian */
  | 'it'
  /** Japanese */
  | 'ja'
  /** Javanese */
  | 'jv'
  /** Georgian */
  | 'ka'
  /** Kikuyu */
  | 'ki'
  /** Kazakh */
  | 'kk'
  /** Kalaallisut */
  | 'kl'
  /** Khmer */
  | 'km'
  /** Kannada */
  | 'kn'
  /** Korean */
  | 'ko'
  /** Kashmiri */
  | 'ks'
  /** Kurdish */
  | 'ku'
  /** Cornish */
  | 'kw'
  /** Kyrgyz */
  | 'ky'
  /** Latin */
  | 'la'
  /** Luxembourgish */
  | 'lb'
  /** Ganda */
  | 'lg'
  /** Lingala */
  | 'ln'
  /** Lao */
  | 'lo'
  /** Lithuanian */
  | 'lt'
  /** Luba-Katanga */
  | 'lu'
  /** Latvian */
  | 'lv'
  /** Malagasy */
  | 'mg'
  /** Maori */
  | 'mi'
  /** Macedonian */
  | 'mk'
  /** Malayalam */
  | 'ml'
  /** Mongolian */
  | 'mn'
  /** Marathi */
  | 'mr'
  /** Malay */
  | 'ms'
  /** Maltese */
  | 'mt'
  /** Burmese */
  | 'my'
  /** Norwegian Bokmål */
  | 'nb'
  /** North Ndebele */
  | 'nd'
  /** Nepali */
  | 'ne'
  /** Dutch */
  | 'nl'
  /** Flemish */
  | 'nl_BE'
  /** Norwegian Nynorsk */
  | 'nn'
  /** Nyanja */
  | 'ny'
  /** Oromo */
  | 'om'
  /** Odia */
  | 'or'
  /** Ossetic */
  | 'os'
  /** Punjabi */
  | 'pa'
  /** Polish */
  | 'pl'
  /** Pashto */
  | 'ps'
  /** Portuguese */
  | 'pt'
  /** Brazilian Portuguese */
  | 'pt_BR'
  /** European Portuguese */
  | 'pt_PT'
  /** Quechua */
  | 'qu'
  /** Romansh */
  | 'rm'
  /** Rundi */
  | 'rn'
  /** Romanian */
  | 'ro'
  /** Moldavian */
  | 'ro_MD'
  /** Russian */
  | 'ru'
  /** Kinyarwanda */
  | 'rw'
  /** Sanskrit */
  | 'sa'
  /** Sindhi */
  | 'sd'
  /** Northern Sami */
  | 'se'
  /** Sango */
  | 'sg'
  /** Sinhala */
  | 'si'
  /** Slovak */
  | 'sk'
  /** Slovenian */
  | 'sl'
  /** Samoan */
  | 'sm'
  /** Shona */
  | 'sn'
  /** Somali */
  | 'so'
  /** Albanian */
  | 'sq'
  /** Serbian */
  | 'sr'
  /** Southern Sotho */
  | 'st'
  /** Sundanese */
  | 'su'
  /** Swedish */
  | 'sv'
  /** Swahili */
  | 'sw'
  /** Congo Swahili */
  | 'sw_CD'
  /** Tamil */
  | 'ta'
  /** Telugu */
  | 'te'
  /** Tajik */
  | 'tg'
  /** Thai */
  | 'th'
  /** Tigrinya */
  | 'ti'
  /** Turkmen */
  | 'tk'
  /** Tongan */
  | 'to'
  /** Turkish */
  | 'tr'
  /** Tatar */
  | 'tt'
  /** Uyghur */
  | 'ug'
  /** Ukrainian */
  | 'uk'
  /** Urdu */
  | 'ur'
  /** Uzbek */
  | 'uz'
  /** Vietnamese */
  | 'vi'
  /** Volapük */
  | 'vo'
  /** Wolof */
  | 'wo'
  /** Xhosa */
  | 'xh'
  /** Yiddish */
  | 'yi'
  /** Yoruba */
  | 'yo'
  /** Chinese */
  | 'zh'
  /** Simplified Chinese */
  | 'zh_Hans'
  /** Traditional Chinese */
  | 'zh_Hant'
  /** Zulu */
  | 'zu';

/** Returned if attempting to set a Channel's defaultLanguageCode to a language which is not enabled in GlobalSettings */
export type LanguageNotAvailableError = ErrorResult & {
  errorCode: ErrorCode;
  languageCode: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

export type LocaleStringCustomFieldConfig = CustomField & {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  length?: Maybe<Scalars['Int']['output']>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  pattern?: Maybe<Scalars['String']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type LocaleTextCustomFieldConfig = CustomField & {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type LocalizedString = {
  languageCode: LanguageCode;
  value: Scalars['String']['output'];
};

export type LogicalOperator =
  | 'AND'
  | 'OR';

export type ManualPaymentInput = {
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  method: Scalars['String']['input'];
  orderId: Scalars['ID']['input'];
  transactionId?: InputMaybe<Scalars['String']['input']>;
};

/**
 * Returned when a call to addManualPaymentToOrder is made but the Order
 * is not in the required state.
 */
export type ManualPaymentStateError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type MetricInterval =
  | 'Daily';

export type MetricSummary = {
  entries: Array<MetricSummaryEntry>;
  interval: MetricInterval;
  title: Scalars['String']['output'];
  type: MetricType;
};

export type MetricSummaryEntry = {
  label: Scalars['String']['output'];
  value: Scalars['Float']['output'];
};

export type MetricSummaryInput = {
  interval: MetricInterval;
  refresh?: InputMaybe<Scalars['Boolean']['input']>;
  types: Array<MetricType>;
};

export type MetricType =
  | 'AverageOrderValue'
  | 'OrderCount'
  | 'OrderTotal';

export type MimeTypeError = ErrorResult & {
  errorCode: ErrorCode;
  fileName: Scalars['String']['output'];
  message: Scalars['String']['output'];
  mimeType: Scalars['String']['output'];
};

/** Returned if a PromotionCondition has neither a couponCode nor any conditions set */
export type MissingConditionsError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type ModerationRule = {
  action: Scalars['String']['output'];
  field: Scalars['String']['output'];
  message?: Maybe<Scalars['String']['output']>;
  operator: Scalars['String']['output'];
  value?: Maybe<Scalars['JSON']['output']>;
};

export type ModerationRuleInput = {
  action: Scalars['String']['input'];
  field: Scalars['String']['input'];
  message?: InputMaybe<Scalars['String']['input']>;
  operator: Scalars['String']['input'];
  value?: InputMaybe<Scalars['JSON']['input']>;
};

export type ModifyOrderInput = {
  addItems?: InputMaybe<Array<AddItemInput>>;
  adjustOrderLines?: InputMaybe<Array<OrderLineInput>>;
  couponCodes?: InputMaybe<Array<Scalars['String']['input']>>;
  customFields?: InputMaybe<UpdateOrderCustomFieldsInput>;
  dryRun: Scalars['Boolean']['input'];
  note?: InputMaybe<Scalars['String']['input']>;
  options?: InputMaybe<ModifyOrderOptions>;
  orderId: Scalars['ID']['input'];
  /**
   * Deprecated in v2.2.0. Use `refunds` instead to allow multiple refunds to be
   * applied in the case that multiple payment methods have been used on the order.
   */
  refund?: InputMaybe<AdministratorRefundInput>;
  refunds?: InputMaybe<Array<AdministratorRefundInput>>;
  /** Added in v2.2 */
  shippingMethodIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  surcharges?: InputMaybe<Array<SurchargeInput>>;
  updateBillingAddress?: InputMaybe<UpdateOrderAddressInput>;
  updateShippingAddress?: InputMaybe<UpdateOrderAddressInput>;
};

export type ModifyOrderOptions = {
  freezePromotions?: InputMaybe<Scalars['Boolean']['input']>;
  recalculateShipping?: InputMaybe<Scalars['Boolean']['input']>;
};

export type ModifyOrderResult = CouponCodeExpiredError | CouponCodeInvalidError | CouponCodeLimitError | IneligibleShippingMethodError | InsufficientStockError | NegativeQuantityError | NoChangesSpecifiedError | Order | OrderLimitError | OrderModificationStateError | PaymentMethodMissingError | RefundPaymentIdMissingError;

export type MoveCollectionInput = {
  collectionId: Scalars['ID']['input'];
  index: Scalars['Int']['input'];
  parentId: Scalars['ID']['input'];
};

/** Returned if an operation has specified OrderLines from multiple Orders */
export type MultipleOrderError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type Mutation = {
  /**  FSM: valid transitions enforced  */
  activateSellerPromotion: SellerPromotionCampaign;
  addBbbMember: BbbOrganizationMember;
  /** Add Customers to a CustomerGroup */
  addCustomersToGroup: CustomerGroup;
  addFulfillmentToOrder: AddFulfillmentToOrderResult;
  /** Adds an item to the draft Order. */
  addItemToDraftOrder: UpdateOrderItemsResult;
  /**
   * Used to manually create a new Payment against an Order.
   * This can be used by an Administrator when an Order is in the ArrangingPayment state.
   *
   * It is also used when a completed Order
   * has been modified (using `modifyOrder`) and the price has increased. The extra payment
   * can then be manually arranged by the administrator, and the details used to create a new
   * Payment.
   */
  addManualPaymentToOrder: AddManualPaymentToOrderResult;
  /** Add members to a Zone */
  addMembersToZone: Zone;
  addNoteToCustomer: Customer;
  addNoteToOrder: Order;
  /** Add an OptionGroup to a Product */
  addOptionGroupToProduct: Product;
  /** Adjusts a draft OrderLine. If custom fields are defined on the OrderLine entity, a third argument 'customFields' of type `OrderLineCustomFieldsInput` will be available. */
  adjustDraftOrderLine: UpdateOrderItemsResult;
  /**
   * Admin: direct budget adjustment (CREDIT/DEBIT) with mandatory audit trail.
   * Requires SuperAdmin. Idempotency key prevents double adjustments.
   */
  adminAdjustCampaignBudget: AdminBudgetAdjustmentResult;
  /**
   * Admin: assign a promotion plan to a seller/channel.
   * Requires SuperAdmin.
   */
  adminAssignPromotionPlan: PromotionPlanAssignment;
  adminClearGeolocationCache: MutationResult;
  /**  Admin: create a new promotion plan  */
  adminCreatePromotionPlan: PromotionPlan;
  /**  Admin: delete a promotion plan  */
  adminDeletePromotionPlan: Scalars['Boolean']['output'];
  /**
   * Admin override: force any state transition, bypasses FSM guard.
   * Emits SellerPromotionChangedEvent for projection/reindex.
   * Requires SuperAdmin.
   */
  adminForceTransitionCampaign: SellerPromotionCampaign;
  /**  Admin: update an existing promotion plan  */
  adminUpdatePromotionPlan: PromotionPlan;
  /** Applies the given coupon code to the draft Order */
  applyCouponCodeToDraftOrder: ApplyCouponCodeResult;
  approveProductReview?: Maybe<ProductReview>;
  /** Assign assets to channel */
  assignAssetsToChannel: Array<Asset>;
  /** Assigns Collections to the specified Channel */
  assignCollectionsToChannel: Array<Collection>;
  /** Assigns Facets to the specified Channel */
  assignFacetsToChannel: Array<Facet>;
  /** Assigns PaymentMethods to the specified Channel */
  assignPaymentMethodsToChannel: Array<PaymentMethod>;
  /** Assigns ProductVariants to the specified Channel */
  assignProductVariantsToChannel: Array<ProductVariant>;
  /** Assigns all ProductVariants of Product to the specified Channel */
  assignProductsToChannel: Array<Product>;
  /** Assigns Promotions to the specified Channel */
  assignPromotionsToChannel: Array<Promotion>;
  /** Assign a Role to an Administrator */
  assignRoleToAdministrator: Administrator;
  /** Phase 2 — Assign collection tree to a seller. Replaces assignSellerTaxonomyByCategory. */
  assignSellerCollectionTree: Scalars['Boolean']['output'];
  /** Phase 3 — Assign a policy to a seller's operations profile */
  assignSellerPolicyToProfile: SellerOperationsProfile;
  /**
   * Assign taxonomy (collections + facets) to a seller based on their primaryCategory.
   * Uses the CATEGORY_TAXONOMY map — admin confirms before applying.
   */
  assignSellerTaxonomyByCategory: Scalars['Boolean']['output'];
  /** Assigns ShippingMethods to the specified Channel */
  assignShippingMethodsToChannel: Array<ShippingMethod>;
  /** Assigns StockLocations to the specified Channel */
  assignStockLocationsToChannel: Array<StockLocation>;
  /** Authenticates the user using a named authentication strategy */
  authenticate: AuthenticationResult;
  bulkApplyVariantCashbackRate: Scalars['Int']['output'];
  bulkSetVariantCashbackActive: Scalars['Int']['output'];
  bulkSetVariantCashbackWindow: Scalars['Int']['output'];
  bulkTransitionSellerOnboarding: BulkTransitionResult;
  bulkTransitionSellerOnboardingState: BulkTransitionSellerStateResult;
  bulkTransitionSellerOperationalState: BulkTransitionSellerStateResult;
  bulkTransitionSellerVerificationState: BulkTransitionSellerStateResult;
  cancelBbbScheduledSession: BbbScheduledSession;
  cancelDelivery: CancelDeliveryResult;
  cancelJob: Job;
  cancelOrder: CancelOrderResult;
  cancelPayment: CancelPaymentResult;
  cancelSellerPromotion: SellerPromotionCampaign;
  /**  Billing: confirm payment and credit the account  */
  confirmPromotionTopup: PromotionTopupConfirmation;
  /** Create a new Administrator */
  createAdministrator: Administrator;
  /** Create a new Asset */
  createAssets: Array<CreateAssetResult>;
  createBbbCapacityGrant: BbbCapacityGrant;
  createBbbMeeting: BbbMeeting;
  createBbbOrganization: BbbOrganization;
  createBbbRoom: BbbRoom;
  createBbbScheduledSession: BbbScheduledSession;
  createBbbServer: BbbServer;
  /** Create a new Channel */
  createChannel: CreateChannelResult;
  /** Create a new Collection */
  createCollection: Collection;
  /** Create a new Country */
  createCountry: Country;
  /** Create a new Customer. If a password is provided, a new User will also be created an linked to the Customer. */
  createCustomer: CreateCustomerResult;
  /** Create a new Address and associate it with the Customer specified by customerId */
  createCustomerAddress: Address;
  /** Create a new CustomerGroup */
  createCustomerGroup: CustomerGroup;
  /** Creates a draft Order */
  createDraftOrder: Order;
  /** Create a new Facet */
  createFacet: Facet;
  /** Create a single FacetValue */
  createFacetValue: FacetValue;
  /** Create one or more FacetValues */
  createFacetValues: Array<FacetValue>;
  /** Create existing PaymentMethod */
  createPaymentMethod: PaymentMethod;
  /** Create a new Product */
  createProduct: Product;
  /** Create a new ProductOption within a ProductOptionGroup */
  createProductOption: ProductOption;
  /** Create a new ProductOptionGroup */
  createProductOptionGroup: ProductOptionGroup;
  /** Create a set of ProductVariants based on the OptionGroups assigned to the given Product */
  createProductVariants: Array<Maybe<ProductVariant>>;
  createPromotion: CreatePromotionResult;
  /**  Billing: initiate a top-up payment intent  */
  createPromotionTopupIntent: PromotionTopupIntent;
  /** Create a new Province */
  createProvince: Province;
  /** Create a new Role */
  createRole: Role;
  /** Create a new Seller */
  createSeller: Seller;
  createSellerCashbackPolicy: SellerCashbackPolicy;
  /** Phase 3 — Create a new category policy */
  createSellerCategoryPolicy: SellerCategoryPolicy;
  /**  Create a campaign in DRAFT state  */
  createSellerPromotion: SellerPromotionCampaign;
  /** Create a new ShippingMethod */
  createShippingMethod: ShippingMethod;
  createStockLocation: StockLocation;
  /** Create a new Tag */
  createTag: Tag;
  /** Create a new TaxCategory */
  createTaxCategory: TaxCategory;
  /** Create a new TaxRate */
  createTaxRate: TaxRate;
  /** Create a new Zone */
  createZone: Zone;
  /** Delete an Administrator */
  deleteAdministrator: DeletionResponse;
  /** Delete multiple Administrators */
  deleteAdministrators: Array<DeletionResponse>;
  /** Delete an Asset */
  deleteAsset: DeletionResponse;
  /** Delete multiple Assets */
  deleteAssets: DeletionResponse;
  deleteBbbMeeting: Scalars['Boolean']['output'];
  deleteBbbOrganization: Scalars['Boolean']['output'];
  deleteBbbRoom: Scalars['Boolean']['output'];
  deleteBbbServer: Scalars['Boolean']['output'];
  /** Delete a Channel */
  deleteChannel: DeletionResponse;
  /** Delete multiple Channels */
  deleteChannels: Array<DeletionResponse>;
  /** Delete a Collection and all of its descendants */
  deleteCollection: DeletionResponse;
  /** Delete multiple Collections and all of their descendants */
  deleteCollections: Array<DeletionResponse>;
  /** Delete multiple Countries */
  deleteCountries: Array<DeletionResponse>;
  /** Delete a Country */
  deleteCountry: DeletionResponse;
  /** Delete a Customer */
  deleteCustomer: DeletionResponse;
  /** Update an existing Address */
  deleteCustomerAddress: Success;
  /** Delete a CustomerGroup */
  deleteCustomerGroup: DeletionResponse;
  /** Delete multiple CustomerGroups */
  deleteCustomerGroups: Array<DeletionResponse>;
  deleteCustomerNote: DeletionResponse;
  /** Deletes Customers */
  deleteCustomers: Array<DeletionResponse>;
  /** Deletes a draft Order */
  deleteDraftOrder: DeletionResponse;
  /** Delete an existing Facet */
  deleteFacet: DeletionResponse;
  /** Delete one or more FacetValues */
  deleteFacetValues: Array<DeletionResponse>;
  /** Delete multiple existing Facets */
  deleteFacets: Array<DeletionResponse>;
  deleteOrderNote: DeletionResponse;
  /** Delete a PaymentMethod */
  deletePaymentMethod: DeletionResponse;
  /** Delete multiple PaymentMethods */
  deletePaymentMethods: Array<DeletionResponse>;
  /** Delete a Product */
  deleteProduct: DeletionResponse;
  /** Delete a ProductOption */
  deleteProductOption: DeletionResponse;
  /** Delete a ProductVariant */
  deleteProductVariant: DeletionResponse;
  /** Delete multiple ProductVariants */
  deleteProductVariants: Array<DeletionResponse>;
  /** Delete multiple Products */
  deleteProducts: Array<DeletionResponse>;
  deletePromotion: DeletionResponse;
  deletePromotions: Array<DeletionResponse>;
  /** Delete a Province */
  deleteProvince: DeletionResponse;
  /** Delete an existing Role */
  deleteRole: DeletionResponse;
  /** Delete multiple Roles */
  deleteRoles: Array<DeletionResponse>;
  /** Delete a Seller */
  deleteSeller: DeletionResponse;
  deleteSellerCashbackPolicy: Scalars['Boolean']['output'];
  /** Phase 3 — Delete a category policy */
  deleteSellerCategoryPolicy: Scalars['Boolean']['output'];
  /** Delete multiple Sellers */
  deleteSellers: Array<DeletionResponse>;
  /** Delete a ShippingMethod */
  deleteShippingMethod: DeletionResponse;
  /** Delete multiple ShippingMethods */
  deleteShippingMethods: Array<DeletionResponse>;
  deleteStockLocation: DeletionResponse;
  deleteStockLocations: Array<DeletionResponse>;
  /** Delete an existing Tag */
  deleteTag: DeletionResponse;
  /** Deletes multiple TaxCategories */
  deleteTaxCategories: Array<DeletionResponse>;
  /** Deletes a TaxCategory */
  deleteTaxCategory: DeletionResponse;
  /** Delete a TaxRate */
  deleteTaxRate: DeletionResponse;
  /** Delete multiple TaxRates */
  deleteTaxRates: Array<DeletionResponse>;
  /** Delete a Zone */
  deleteZone: DeletionResponse;
  /** Delete a Zone */
  deleteZones: Array<DeletionResponse>;
  /**
   * Duplicate an existing entity using a specific EntityDuplicator.
   * Since v2.2.0.
   */
  duplicateEntity: DuplicateEntityResult;
  endBbbMeeting: BbbMeeting;
  expireSellerPromotion: SellerPromotionCampaign;
  flagProductReview?: Maybe<ProductReview>;
  flushBufferedJobs: Success;
  hideProductReview?: Maybe<ProductReview>;
  importProducts?: Maybe<ImportInfo>;
  /**
   * Authenticates the user using the native authentication strategy. This mutation is an alias for authenticate({ native: { ... }})
   *
   * The `rememberMe` option applies when using cookie-based sessions, and if `true` it will set the maxAge of the session cookie
   * to 1 year.
   */
  login: NativeAuthenticationResult;
  logout: Success;
  markPayoutSettled: SellerPayout;
  markSellerOrderAccepted: Order;
  markSellerOrderPacking: Order;
  markSellerOrderReadyForDispatch: Order;
  markSellerOrderReadyForPickup: Order;
  /**
   * Allows an Order to be modified after it has been completed by the Customer. The Order must first
   * be in the `Modifying` state.
   */
  modifyOrder: ModifyOrderResult;
  /** Move a Collection to a different parent or index */
  moveCollection: Collection;
  pauseSellerPromotion: SellerPromotionCampaign;
  refundOrder: RefundOrderResult;
  registerNewSeller?: Maybe<Channel>;
  reindex: Job;
  rejectProductReview?: Maybe<ProductReview>;
  removeBbbMember: BbbOrganizationMember;
  /** Removes Collections from the specified Channel */
  removeCollectionsFromChannel: Array<Collection>;
  /** Removes the given coupon code from the draft Order */
  removeCouponCodeFromDraftOrder?: Maybe<Order>;
  /** Remove Customers from a CustomerGroup */
  removeCustomersFromGroup: CustomerGroup;
  /** Remove an OrderLine from the draft Order */
  removeDraftOrderLine: RemoveOrderItemsResult;
  /** Removes Facets from the specified Channel */
  removeFacetsFromChannel: Array<RemoveFacetFromChannelResult>;
  /** Remove members from a Zone */
  removeMembersFromZone: Zone;
  /**
   * Remove an OptionGroup from a Product. If the OptionGroup is in use by any ProductVariants
   * the mutation will return a ProductOptionInUseError, and the OptionGroup will not be removed.
   * Setting the `force` argument to `true` will override this and remove the OptionGroup anyway,
   * as well as removing any of the group's options from the Product's ProductVariants.
   */
  removeOptionGroupFromProduct: RemoveOptionGroupFromProductResult;
  /** Removes PaymentMethods from the specified Channel */
  removePaymentMethodsFromChannel: Array<PaymentMethod>;
  /** Removes ProductVariants from the specified Channel */
  removeProductVariantsFromChannel: Array<ProductVariant>;
  /** Removes all ProductVariants of Product from the specified Channel */
  removeProductsFromChannel: Array<Product>;
  /** Removes Promotions from the specified Channel */
  removePromotionsFromChannel: Array<Promotion>;
  /** Phase 3 — Remove policy assignment from a seller's operations profile */
  removeSellerPolicyFromProfile: SellerOperationsProfile;
  /** Remove all settled jobs in the given queues older than the given date. Returns the number of jobs deleted. */
  removeSettledJobs: Scalars['Int']['output'];
  /** Removes ShippingMethods from the specified Channel */
  removeShippingMethodsFromChannel: Array<ShippingMethod>;
  /** Removes StockLocations from the specified Channel */
  removeStockLocationsFromChannel: Array<StockLocation>;
  removeVariantCashbackPolicy: Scalars['Boolean']['output'];
  reportReview: Scalars['Boolean']['output'];
  /**  Re-run CQRS projection for a seller (SuperAdmin only). Use after config changes.  */
  reprojectSellerPromotion: Scalars['Boolean']['output'];
  resetBbbRoom: BbbRoom;
  respondToReview?: Maybe<ProductReview>;
  resumeSellerPromotion: SellerPromotionCampaign;
  retryDispatch: RetryDispatchResult;
  runPendingSearchIndexUpdates: Success;
  runScheduledTask: Success;
  runSellerLifecycleBackfill: BackfillResult;
  setCustomerForDraftOrder: SetCustomerForDraftOrderResult;
  /** Sets the billing address for a draft Order */
  setDraftOrderBillingAddress: Order;
  /** Allows any custom fields to be set for the active order */
  setDraftOrderCustomFields: Order;
  /** Sets the shipping address for a draft Order */
  setDraftOrderShippingAddress: Order;
  /** Sets the shipping method by id, which can be obtained with the `eligibleShippingMethodsForDraftOrder` query */
  setDraftOrderShippingMethod: SetOrderShippingMethodResult;
  setOrderCustomFields?: Maybe<Order>;
  /** Allows a different Customer to be assigned to an Order. Added in v2.2.0. */
  setOrderCustomer?: Maybe<Order>;
  /**  FSM: valid transitions enforced  */
  setPendingSellerPromotion: SellerPromotionCampaign;
  /** Set a single key-value pair (automatically scoped based on field configuration) */
  setSettingsStoreValue: SetSettingsStoreValueResult;
  /** Set multiple key-value pairs in a transaction (each automatically scoped) */
  setSettingsStoreValues: Array<SetSettingsStoreValueResult>;
  /** Set all webhooks for the current channel. This will overwrite any existing webhooks. */
  setWebhooks: Array<Webhook>;
  settlePayment: SettlePaymentResult;
  settleRefund: SettleRefundResult;
  submitProductReview: ProductReview;
  toggleMyCashbackPolicy?: Maybe<SellerCashbackPolicy>;
  transitionFulfillmentToState: TransitionFulfillmentToStateResult;
  transitionOrderToState?: Maybe<TransitionOrderToStateResult>;
  transitionPaymentToState: TransitionPaymentToStateResult;
  transitionSellerOnboarding: SellerLifecycleState;
  transitionSellerOperational: SellerLifecycleState;
  transitionSellerVerification: SellerLifecycleState;
  /** Unsets the billing address for a draft Order */
  unsetDraftOrderBillingAddress: Order;
  /** Unsets the shipping address for a draft Order */
  unsetDraftOrderShippingAddress: Order;
  /** Update the active (currently logged-in) Administrator */
  updateActiveAdministrator: Administrator;
  /** Update an existing Administrator */
  updateAdministrator: Administrator;
  /** Update an existing Asset */
  updateAsset: Asset;
  updateBbbMeeting: BbbMeeting;
  updateBbbMember: BbbOrganizationMember;
  updateBbbOrganization: BbbOrganization;
  updateBbbRoom: BbbRoom;
  updateBbbServer: BbbServer;
  /** Update an existing Channel */
  updateChannel: UpdateChannelResult;
  /** Update an existing Collection */
  updateCollection: Collection;
  /** Update an existing Country */
  updateCountry: Country;
  /** Update an existing Customer */
  updateCustomer: UpdateCustomerResult;
  /** Update an existing Address */
  updateCustomerAddress: Address;
  /** Update an existing CustomerGroup */
  updateCustomerGroup: CustomerGroup;
  updateCustomerNote: HistoryEntry;
  /** Update an existing Facet */
  updateFacet: Facet;
  /** Update a single FacetValue */
  updateFacetValue: FacetValue;
  /** Update one or more FacetValues */
  updateFacetValues: Array<FacetValue>;
  updateGlobalSettings: UpdateGlobalSettingsResult;
  updateMySellerOperationsProfile: SellerOperationsProfile;
  updateOrderNote: HistoryEntry;
  /** Update an existing PaymentMethod */
  updatePaymentMethod: PaymentMethod;
  /** Update an existing Product */
  updateProduct: Product;
  /** Create a new ProductOption within a ProductOptionGroup */
  updateProductOption: ProductOption;
  /** Update an existing ProductOptionGroup */
  updateProductOptionGroup: ProductOptionGroup;
  updateProductReview: ProductReview;
  /** Update an existing ProductVariant */
  updateProductVariant: ProductVariant;
  /** Update existing ProductVariants */
  updateProductVariants: Array<Maybe<ProductVariant>>;
  /** Update multiple existing Products */
  updateProducts: Array<Product>;
  updatePromotion: UpdatePromotionResult;
  /** Update an existing Province */
  updateProvince: Province;
  /** Update an existing Role */
  updateRole: Role;
  updateScheduledTask: ScheduledTask;
  /** Update an existing Seller */
  updateSeller: Seller;
  updateSellerCashbackPolicy: SellerCashbackPolicy;
  /** Phase 3 — Update an existing category policy */
  updateSellerCategoryPolicy: SellerCategoryPolicy;
  updateSellerOperationsProfile: SellerOperationsProfile;
  /**  Update campaign metadata (disallowed on EXPIRED/CANCELLED)  */
  updateSellerPromotion: SellerPromotionCampaign;
  /** Update an existing ShippingMethod */
  updateShippingMethod: ShippingMethod;
  updateStockLocation: StockLocation;
  /** Update an existing Tag */
  updateTag: Tag;
  /** Update an existing TaxCategory */
  updateTaxCategory: TaxCategory;
  /** Update an existing TaxRate */
  updateTaxRate: TaxRate;
  /** Update an existing Zone */
  updateZone: Zone;
  upsertCashbackPolicy: SellerCashbackPolicy;
  upsertRedemptionConfig: SellerCashbackRedemptionConfig;
  upsertVariantCashbackPolicy: ProductVariantCashbackPolicy;
  voteOnReview: ProductReview;
};


export type MutationActivateSellerPromotionArgs = {
  campaignId: Scalars['ID']['input'];
};


export type MutationAddBbbMemberArgs = {
  input: AddBbbMemberInput;
};


export type MutationAddCustomersToGroupArgs = {
  customerGroupId: Scalars['ID']['input'];
  customerIds: Array<Scalars['ID']['input']>;
};


export type MutationAddFulfillmentToOrderArgs = {
  input: FulfillOrderInput;
};


export type MutationAddItemToDraftOrderArgs = {
  input: AddItemToDraftOrderInput;
  orderId: Scalars['ID']['input'];
};


export type MutationAddManualPaymentToOrderArgs = {
  input: ManualPaymentInput;
};


export type MutationAddMembersToZoneArgs = {
  memberIds: Array<Scalars['ID']['input']>;
  zoneId: Scalars['ID']['input'];
};


export type MutationAddNoteToCustomerArgs = {
  input: AddNoteToCustomerInput;
};


export type MutationAddNoteToOrderArgs = {
  input: AddNoteToOrderInput;
};


export type MutationAddOptionGroupToProductArgs = {
  optionGroupId: Scalars['ID']['input'];
  productId: Scalars['ID']['input'];
};


export type MutationAdjustDraftOrderLineArgs = {
  input: AdjustDraftOrderLineInput;
  orderId: Scalars['ID']['input'];
};


export type MutationAdminAdjustCampaignBudgetArgs = {
  input: AdminBudgetAdjustmentInput;
};


export type MutationAdminAssignPromotionPlanArgs = {
  input: AssignPromotionPlanInput;
};


export type MutationAdminCreatePromotionPlanArgs = {
  input: CreatePromotionPlanInput;
};


export type MutationAdminDeletePromotionPlanArgs = {
  id: Scalars['ID']['input'];
};


export type MutationAdminForceTransitionCampaignArgs = {
  campaignId: Scalars['ID']['input'];
  toStatus: SellerPromotionStatus;
};


export type MutationAdminUpdatePromotionPlanArgs = {
  id: Scalars['ID']['input'];
  input: UpdatePromotionPlanInput;
};


export type MutationApplyCouponCodeToDraftOrderArgs = {
  couponCode: Scalars['String']['input'];
  orderId: Scalars['ID']['input'];
};


export type MutationApproveProductReviewArgs = {
  id: Scalars['ID']['input'];
};


export type MutationAssignAssetsToChannelArgs = {
  input: AssignAssetsToChannelInput;
};


export type MutationAssignCollectionsToChannelArgs = {
  input: AssignCollectionsToChannelInput;
};


export type MutationAssignFacetsToChannelArgs = {
  input: AssignFacetsToChannelInput;
};


export type MutationAssignPaymentMethodsToChannelArgs = {
  input: AssignPaymentMethodsToChannelInput;
};


export type MutationAssignProductVariantsToChannelArgs = {
  input: AssignProductVariantsToChannelInput;
};


export type MutationAssignProductsToChannelArgs = {
  input: AssignProductsToChannelInput;
};


export type MutationAssignPromotionsToChannelArgs = {
  input: AssignPromotionsToChannelInput;
};


export type MutationAssignRoleToAdministratorArgs = {
  administratorId: Scalars['ID']['input'];
  roleId: Scalars['ID']['input'];
};


export type MutationAssignSellerCollectionTreeArgs = {
  assignToChannel?: InputMaybe<Scalars['Boolean']['input']>;
  rootCollectionIds: Array<Scalars['ID']['input']>;
  sellerId: Scalars['ID']['input'];
};


export type MutationAssignSellerPolicyToProfileArgs = {
  policyCode: Scalars['String']['input'];
  sellerId: Scalars['ID']['input'];
};


export type MutationAssignSellerTaxonomyByCategoryArgs = {
  category: Scalars['String']['input'];
  sellerId: Scalars['ID']['input'];
};


export type MutationAssignShippingMethodsToChannelArgs = {
  input: AssignShippingMethodsToChannelInput;
};


export type MutationAssignStockLocationsToChannelArgs = {
  input: AssignStockLocationsToChannelInput;
};


export type MutationAuthenticateArgs = {
  input: AuthenticationInput;
  rememberMe?: InputMaybe<Scalars['Boolean']['input']>;
};


export type MutationBulkApplyVariantCashbackRateArgs = {
  productVariantIds: Array<Scalars['ID']['input']>;
  rateType: Scalars['String']['input'];
  rateValue: Scalars['Int']['input'];
};


export type MutationBulkSetVariantCashbackActiveArgs = {
  isActive: Scalars['Boolean']['input'];
  productVariantIds: Array<Scalars['ID']['input']>;
};


export type MutationBulkSetVariantCashbackWindowArgs = {
  endsAt?: InputMaybe<Scalars['DateTime']['input']>;
  productVariantIds: Array<Scalars['ID']['input']>;
  startsAt?: InputMaybe<Scalars['DateTime']['input']>;
};


export type MutationBulkTransitionSellerOnboardingArgs = {
  sellerIds: Array<Scalars['ID']['input']>;
  transition: SellerOnboardingTransition;
};


export type MutationBulkTransitionSellerOnboardingStateArgs = {
  sellerIds: Array<Scalars['ID']['input']>;
  transition: SellerOnboardingTransition;
};


export type MutationBulkTransitionSellerOperationalStateArgs = {
  sellerIds: Array<Scalars['ID']['input']>;
  transition: SellerOperationalTransition;
};


export type MutationBulkTransitionSellerVerificationStateArgs = {
  sellerIds: Array<Scalars['ID']['input']>;
  transition: SellerVerificationTransition;
};


export type MutationCancelBbbScheduledSessionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCancelDeliveryArgs = {
  reason?: InputMaybe<Scalars['String']['input']>;
  sellerOrderId: Scalars['ID']['input'];
};


export type MutationCancelJobArgs = {
  jobId: Scalars['ID']['input'];
};


export type MutationCancelOrderArgs = {
  input: CancelOrderInput;
};


export type MutationCancelPaymentArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCancelSellerPromotionArgs = {
  campaignId: Scalars['ID']['input'];
};


export type MutationConfirmPromotionTopupArgs = {
  input: ConfirmPromotionTopupInput;
};


export type MutationCreateAdministratorArgs = {
  input: CreateAdministratorInput;
};


export type MutationCreateAssetsArgs = {
  input: Array<CreateAssetInput>;
};


export type MutationCreateBbbCapacityGrantArgs = {
  input: CreateBbbCapacityGrantInput;
};


export type MutationCreateBbbMeetingArgs = {
  input: CreateBbbMeetingInput;
};


export type MutationCreateBbbOrganizationArgs = {
  input: CreateBbbOrganizationInput;
};


export type MutationCreateBbbRoomArgs = {
  input: CreateBbbRoomInput;
};


export type MutationCreateBbbScheduledSessionArgs = {
  input: CreateBbbScheduledSessionInput;
};


export type MutationCreateBbbServerArgs = {
  input: CreateBbbServerInput;
};


export type MutationCreateChannelArgs = {
  input: CreateChannelInput;
};


export type MutationCreateCollectionArgs = {
  input: CreateCollectionInput;
};


export type MutationCreateCountryArgs = {
  input: CreateCountryInput;
};


export type MutationCreateCustomerArgs = {
  input: CreateCustomerInput;
  password?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateCustomerAddressArgs = {
  customerId: Scalars['ID']['input'];
  input: CreateAddressInput;
};


export type MutationCreateCustomerGroupArgs = {
  input: CreateCustomerGroupInput;
};


export type MutationCreateFacetArgs = {
  input: CreateFacetInput;
};


export type MutationCreateFacetValueArgs = {
  input: CreateFacetValueInput;
};


export type MutationCreateFacetValuesArgs = {
  input: Array<CreateFacetValueInput>;
};


export type MutationCreatePaymentMethodArgs = {
  input: CreatePaymentMethodInput;
};


export type MutationCreateProductArgs = {
  input: CreateProductInput;
};


export type MutationCreateProductOptionArgs = {
  input: CreateProductOptionInput;
};


export type MutationCreateProductOptionGroupArgs = {
  input: CreateProductOptionGroupInput;
};


export type MutationCreateProductVariantsArgs = {
  input: Array<CreateProductVariantInput>;
};


export type MutationCreatePromotionArgs = {
  input: CreatePromotionInput;
};


export type MutationCreatePromotionTopupIntentArgs = {
  input: CreatePromotionTopupIntentInput;
};


export type MutationCreateProvinceArgs = {
  input: CreateProvinceInput;
};


export type MutationCreateRoleArgs = {
  input: CreateRoleInput;
};


export type MutationCreateSellerArgs = {
  input: CreateSellerInput;
};


export type MutationCreateSellerCashbackPolicyArgs = {
  input: CreateSellerCashbackPolicyInput;
};


export type MutationCreateSellerCategoryPolicyArgs = {
  input: CreateSellerCategoryPolicyInput;
};


export type MutationCreateSellerPromotionArgs = {
  input: CreateSellerPromotionInput;
};


export type MutationCreateShippingMethodArgs = {
  input: CreateShippingMethodInput;
};


export type MutationCreateStockLocationArgs = {
  input: CreateStockLocationInput;
};


export type MutationCreateTagArgs = {
  input: CreateTagInput;
};


export type MutationCreateTaxCategoryArgs = {
  input: CreateTaxCategoryInput;
};


export type MutationCreateTaxRateArgs = {
  input: CreateTaxRateInput;
};


export type MutationCreateZoneArgs = {
  input: CreateZoneInput;
};


export type MutationDeleteAdministratorArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteAdministratorsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteAssetArgs = {
  input: DeleteAssetInput;
};


export type MutationDeleteAssetsArgs = {
  input: DeleteAssetsInput;
};


export type MutationDeleteBbbMeetingArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteBbbOrganizationArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteBbbRoomArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteBbbServerArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteChannelArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteChannelsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteCollectionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCollectionsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteCountriesArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteCountryArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCustomerArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCustomerAddressArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCustomerGroupArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCustomerGroupsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteCustomerNoteArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCustomersArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteDraftOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationDeleteFacetArgs = {
  force?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
};


export type MutationDeleteFacetValuesArgs = {
  force?: InputMaybe<Scalars['Boolean']['input']>;
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteFacetsArgs = {
  force?: InputMaybe<Scalars['Boolean']['input']>;
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteOrderNoteArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeletePaymentMethodArgs = {
  force?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
};


export type MutationDeletePaymentMethodsArgs = {
  force?: InputMaybe<Scalars['Boolean']['input']>;
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteProductArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteProductOptionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteProductVariantArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteProductVariantsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteProductsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeletePromotionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeletePromotionsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteProvinceArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteRoleArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteRolesArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteSellerArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteSellerCashbackPolicyArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteSellerCategoryPolicyArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteSellersArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteShippingMethodArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteShippingMethodsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteStockLocationArgs = {
  input: DeleteStockLocationInput;
};


export type MutationDeleteStockLocationsArgs = {
  input: Array<DeleteStockLocationInput>;
};


export type MutationDeleteTagArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteTaxCategoriesArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteTaxCategoryArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteTaxRateArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteTaxRatesArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDeleteZoneArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteZonesArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationDuplicateEntityArgs = {
  input: DuplicateEntityInput;
};


export type MutationEndBbbMeetingArgs = {
  id: Scalars['ID']['input'];
};


export type MutationExpireSellerPromotionArgs = {
  campaignId: Scalars['ID']['input'];
};


export type MutationFlagProductReviewArgs = {
  id: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationFlushBufferedJobsArgs = {
  bufferIds?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type MutationHideProductReviewArgs = {
  id: Scalars['ID']['input'];
};


export type MutationImportProductsArgs = {
  csvFile: Scalars['Upload']['input'];
};


export type MutationLoginArgs = {
  password: Scalars['String']['input'];
  rememberMe?: InputMaybe<Scalars['Boolean']['input']>;
  username: Scalars['String']['input'];
};


export type MutationMarkPayoutSettledArgs = {
  id: Scalars['ID']['input'];
  transactionRef: Scalars['String']['input'];
};


export type MutationMarkSellerOrderAcceptedArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationMarkSellerOrderPackingArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationMarkSellerOrderReadyForDispatchArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationMarkSellerOrderReadyForPickupArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationModifyOrderArgs = {
  input: ModifyOrderInput;
};


export type MutationMoveCollectionArgs = {
  input: MoveCollectionInput;
};


export type MutationPauseSellerPromotionArgs = {
  campaignId: Scalars['ID']['input'];
};


export type MutationRefundOrderArgs = {
  input: RefundOrderInput;
};


export type MutationRegisterNewSellerArgs = {
  input: RegisterSellerInput;
};


export type MutationRejectProductReviewArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveBbbMemberArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRemoveCollectionsFromChannelArgs = {
  input: RemoveCollectionsFromChannelInput;
};


export type MutationRemoveCouponCodeFromDraftOrderArgs = {
  couponCode: Scalars['String']['input'];
  orderId: Scalars['ID']['input'];
};


export type MutationRemoveCustomersFromGroupArgs = {
  customerGroupId: Scalars['ID']['input'];
  customerIds: Array<Scalars['ID']['input']>;
};


export type MutationRemoveDraftOrderLineArgs = {
  orderId: Scalars['ID']['input'];
  orderLineId: Scalars['ID']['input'];
};


export type MutationRemoveFacetsFromChannelArgs = {
  input: RemoveFacetsFromChannelInput;
};


export type MutationRemoveMembersFromZoneArgs = {
  memberIds: Array<Scalars['ID']['input']>;
  zoneId: Scalars['ID']['input'];
};


export type MutationRemoveOptionGroupFromProductArgs = {
  force?: InputMaybe<Scalars['Boolean']['input']>;
  optionGroupId: Scalars['ID']['input'];
  productId: Scalars['ID']['input'];
};


export type MutationRemovePaymentMethodsFromChannelArgs = {
  input: RemovePaymentMethodsFromChannelInput;
};


export type MutationRemoveProductVariantsFromChannelArgs = {
  input: RemoveProductVariantsFromChannelInput;
};


export type MutationRemoveProductsFromChannelArgs = {
  input: RemoveProductsFromChannelInput;
};


export type MutationRemovePromotionsFromChannelArgs = {
  input: RemovePromotionsFromChannelInput;
};


export type MutationRemoveSellerPolicyFromProfileArgs = {
  sellerId: Scalars['ID']['input'];
};


export type MutationRemoveSettledJobsArgs = {
  olderThan?: InputMaybe<Scalars['DateTime']['input']>;
  queueNames?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type MutationRemoveShippingMethodsFromChannelArgs = {
  input: RemoveShippingMethodsFromChannelInput;
};


export type MutationRemoveStockLocationsFromChannelArgs = {
  input: RemoveStockLocationsFromChannelInput;
};


export type MutationRemoveVariantCashbackPolicyArgs = {
  productVariantId: Scalars['ID']['input'];
};


export type MutationReportReviewArgs = {
  input: ReportReviewInput;
};


export type MutationReprojectSellerPromotionArgs = {
  sellerId: Scalars['ID']['input'];
};


export type MutationResetBbbRoomArgs = {
  id: Scalars['ID']['input'];
};


export type MutationRespondToReviewArgs = {
  id: Scalars['ID']['input'];
  response: Scalars['String']['input'];
};


export type MutationResumeSellerPromotionArgs = {
  campaignId: Scalars['ID']['input'];
};


export type MutationRetryDispatchArgs = {
  sellerOrderId: Scalars['ID']['input'];
};


export type MutationRunScheduledTaskArgs = {
  id: Scalars['String']['input'];
};


export type MutationSetCustomerForDraftOrderArgs = {
  customerId?: InputMaybe<Scalars['ID']['input']>;
  input?: InputMaybe<CreateCustomerInput>;
  orderId: Scalars['ID']['input'];
};


export type MutationSetDraftOrderBillingAddressArgs = {
  input: CreateAddressInput;
  orderId: Scalars['ID']['input'];
};


export type MutationSetDraftOrderCustomFieldsArgs = {
  input: UpdateOrderInput;
  orderId: Scalars['ID']['input'];
};


export type MutationSetDraftOrderShippingAddressArgs = {
  input: CreateAddressInput;
  orderId: Scalars['ID']['input'];
};


export type MutationSetDraftOrderShippingMethodArgs = {
  orderId: Scalars['ID']['input'];
  shippingMethodId: Scalars['ID']['input'];
};


export type MutationSetOrderCustomFieldsArgs = {
  input: UpdateOrderInput;
};


export type MutationSetOrderCustomerArgs = {
  input: SetOrderCustomerInput;
};


export type MutationSetPendingSellerPromotionArgs = {
  campaignId: Scalars['ID']['input'];
};


export type MutationSetSettingsStoreValueArgs = {
  input: SettingsStoreInput;
};


export type MutationSetSettingsStoreValuesArgs = {
  inputs: Array<SettingsStoreInput>;
};


export type MutationSetWebhooksArgs = {
  webhooks: Array<WebhookInput>;
};


export type MutationSettlePaymentArgs = {
  id: Scalars['ID']['input'];
};


export type MutationSettleRefundArgs = {
  input: SettleRefundInput;
};


export type MutationSubmitProductReviewArgs = {
  input: SubmitProductReviewInput;
};


export type MutationToggleMyCashbackPolicyArgs = {
  isActive: Scalars['Boolean']['input'];
};


export type MutationTransitionFulfillmentToStateArgs = {
  id: Scalars['ID']['input'];
  state: Scalars['String']['input'];
};


export type MutationTransitionOrderToStateArgs = {
  id: Scalars['ID']['input'];
  state: Scalars['String']['input'];
};


export type MutationTransitionPaymentToStateArgs = {
  id: Scalars['ID']['input'];
  state: Scalars['String']['input'];
};


export type MutationTransitionSellerOnboardingArgs = {
  sellerId: Scalars['ID']['input'];
  transition: SellerOnboardingTransition;
};


export type MutationTransitionSellerOperationalArgs = {
  sellerId: Scalars['ID']['input'];
  transition: SellerOperationalTransition;
};


export type MutationTransitionSellerVerificationArgs = {
  sellerId: Scalars['ID']['input'];
  transition: SellerVerificationTransition;
};


export type MutationUnsetDraftOrderBillingAddressArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationUnsetDraftOrderShippingAddressArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationUpdateActiveAdministratorArgs = {
  input: UpdateActiveAdministratorInput;
};


export type MutationUpdateAdministratorArgs = {
  input: UpdateAdministratorInput;
};


export type MutationUpdateAssetArgs = {
  input: UpdateAssetInput;
};


export type MutationUpdateBbbMeetingArgs = {
  id: Scalars['ID']['input'];
  input: UpdateBbbMeetingInput;
};


export type MutationUpdateBbbMemberArgs = {
  id: Scalars['ID']['input'];
  input: UpdateBbbMemberInput;
};


export type MutationUpdateBbbOrganizationArgs = {
  id: Scalars['ID']['input'];
  input: UpdateBbbOrganizationInput;
};


export type MutationUpdateBbbRoomArgs = {
  id: Scalars['ID']['input'];
  input: UpdateBbbRoomInput;
};


export type MutationUpdateBbbServerArgs = {
  id: Scalars['ID']['input'];
  input: UpdateBbbServerInput;
};


export type MutationUpdateChannelArgs = {
  input: UpdateChannelInput;
};


export type MutationUpdateCollectionArgs = {
  input: UpdateCollectionInput;
};


export type MutationUpdateCountryArgs = {
  input: UpdateCountryInput;
};


export type MutationUpdateCustomerArgs = {
  input: UpdateCustomerInput;
};


export type MutationUpdateCustomerAddressArgs = {
  input: UpdateAddressInput;
};


export type MutationUpdateCustomerGroupArgs = {
  input: UpdateCustomerGroupInput;
};


export type MutationUpdateCustomerNoteArgs = {
  input: UpdateCustomerNoteInput;
};


export type MutationUpdateFacetArgs = {
  input: UpdateFacetInput;
};


export type MutationUpdateFacetValueArgs = {
  input: UpdateFacetValueInput;
};


export type MutationUpdateFacetValuesArgs = {
  input: Array<UpdateFacetValueInput>;
};


export type MutationUpdateGlobalSettingsArgs = {
  input: UpdateGlobalSettingsInput;
};


export type MutationUpdateMySellerOperationsProfileArgs = {
  input: UpdateMySellerOperationsProfileInput;
};


export type MutationUpdateOrderNoteArgs = {
  input: UpdateOrderNoteInput;
};


export type MutationUpdatePaymentMethodArgs = {
  input: UpdatePaymentMethodInput;
};


export type MutationUpdateProductArgs = {
  input: UpdateProductInput;
};


export type MutationUpdateProductOptionArgs = {
  input: UpdateProductOptionInput;
};


export type MutationUpdateProductOptionGroupArgs = {
  input: UpdateProductOptionGroupInput;
};


export type MutationUpdateProductReviewArgs = {
  input: UpdateProductReviewInput;
};


export type MutationUpdateProductVariantArgs = {
  input: UpdateProductVariantInput;
};


export type MutationUpdateProductVariantsArgs = {
  input: Array<UpdateProductVariantInput>;
};


export type MutationUpdateProductsArgs = {
  input: Array<UpdateProductInput>;
};


export type MutationUpdatePromotionArgs = {
  input: UpdatePromotionInput;
};


export type MutationUpdateProvinceArgs = {
  input: UpdateProvinceInput;
};


export type MutationUpdateRoleArgs = {
  input: UpdateRoleInput;
};


export type MutationUpdateScheduledTaskArgs = {
  input: UpdateScheduledTaskInput;
};


export type MutationUpdateSellerArgs = {
  input: UpdateSellerInput;
};


export type MutationUpdateSellerCashbackPolicyArgs = {
  id: Scalars['ID']['input'];
  input: UpdateSellerCashbackPolicyInput;
};


export type MutationUpdateSellerCategoryPolicyArgs = {
  id: Scalars['ID']['input'];
  input: UpdateSellerCategoryPolicyInput;
};


export type MutationUpdateSellerOperationsProfileArgs = {
  input: UpdateSellerOperationsProfileInput;
};


export type MutationUpdateSellerPromotionArgs = {
  input: UpdateSellerPromotionInput;
};


export type MutationUpdateShippingMethodArgs = {
  input: UpdateShippingMethodInput;
};


export type MutationUpdateStockLocationArgs = {
  input: UpdateStockLocationInput;
};


export type MutationUpdateTagArgs = {
  input: UpdateTagInput;
};


export type MutationUpdateTaxCategoryArgs = {
  input: UpdateTaxCategoryInput;
};


export type MutationUpdateTaxRateArgs = {
  input: UpdateTaxRateInput;
};


export type MutationUpdateZoneArgs = {
  input: UpdateZoneInput;
};


export type MutationUpsertCashbackPolicyArgs = {
  input: UpsertSellerCashbackPolicyInput;
};


export type MutationUpsertRedemptionConfigArgs = {
  input: UpsertRedemptionConfigInput;
};


export type MutationUpsertVariantCashbackPolicyArgs = {
  input: UpsertVariantCashbackPolicyInput;
  productVariantId: Scalars['ID']['input'];
};


export type MutationVoteOnReviewArgs = {
  id: Scalars['ID']['input'];
  vote: Scalars['Boolean']['input'];
};

export type MutationResult = {
  message: Scalars['String']['output'];
  success: Scalars['Boolean']['output'];
};

export type NativeAuthInput = {
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

/** Returned when attempting an operation that relies on the NativeAuthStrategy, if that strategy is not configured. */
export type NativeAuthStrategyError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type NativeAuthenticationResult = CurrentUser | InvalidCredentialsError | NativeAuthStrategyError;

/** Returned when attempting to set a negative OrderLine quantity. */
export type NegativeQuantityError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/**
 * Returned when invoking a mutation which depends on there being an active Order on the
 * current session.
 */
export type NoActiveOrderError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/** Returned when a call to modifyOrder fails to specify any changes */
export type NoChangesSpecifiedError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type Node = {
  id: Scalars['ID']['output'];
};

/** Returned if an attempting to refund an Order but neither items nor shipping refund was specified */
export type NothingToRefundError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/** Operators for filtering on a list of Number fields */
export type NumberListOperators = {
  inList: Scalars['Float']['input'];
};

/** Operators for filtering on a Int or Float field */
export type NumberOperators = {
  between?: InputMaybe<NumberRange>;
  eq?: InputMaybe<Scalars['Float']['input']>;
  gt?: InputMaybe<Scalars['Float']['input']>;
  gte?: InputMaybe<Scalars['Float']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  lt?: InputMaybe<Scalars['Float']['input']>;
  lte?: InputMaybe<Scalars['Float']['input']>;
};

export type NumberRange = {
  end: Scalars['Float']['input'];
  start: Scalars['Float']['input'];
};

export type Order = Node & {
  /** An order is active as long as the payment process has not been completed */
  active: Scalars['Boolean']['output'];
  aggregateOrder?: Maybe<Order>;
  aggregateOrderId?: Maybe<Scalars['ID']['output']>;
  billingAddress?: Maybe<OrderAddress>;
  channels: Array<Channel>;
  /** A unique code for the Order */
  code: Scalars['String']['output'];
  /** An array of all coupon codes applied to the Order */
  couponCodes: Array<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  currencyCode: CurrencyCode;
  customFields?: Maybe<OrderCustomFields>;
  customer?: Maybe<Customer>;
  discounts: Array<Discount>;
  fulfillments?: Maybe<Array<Fulfillment>>;
  history: HistoryEntryList;
  id: Scalars['ID']['output'];
  lines: Array<OrderLine>;
  modifications: Array<OrderModification>;
  nextStates: Array<Scalars['String']['output']>;
  /**
   * The date & time that the Order was placed, i.e. the Customer
   * completed the checkout and the Order is no longer "active"
   */
  orderPlacedAt?: Maybe<Scalars['DateTime']['output']>;
  payments?: Maybe<Array<Payment>>;
  /** Promotions applied to the order. Only gets populated after the payment process has completed. */
  promotions: Array<Promotion>;
  sellerOrders?: Maybe<Array<Order>>;
  shipping: Scalars['Money']['output'];
  shippingAddress?: Maybe<OrderAddress>;
  shippingLines: Array<ShippingLine>;
  shippingWithTax: Scalars['Money']['output'];
  state: Scalars['String']['output'];
  /**
   * The subTotal is the total of all OrderLines in the Order. This figure also includes any Order-level
   * discounts which have been prorated (proportionally distributed) amongst the items of each OrderLine.
   * To get a total of all OrderLines which does not account for prorated discounts, use the
   * sum of `OrderLine.discountedLinePrice` values.
   */
  subTotal: Scalars['Money']['output'];
  /** Same as subTotal, but inclusive of tax */
  subTotalWithTax: Scalars['Money']['output'];
  /**
   * Surcharges are arbitrary modifications to the Order total which are neither
   * ProductVariants nor discounts resulting from applied Promotions. For example,
   * one-off discounts based on customer interaction, or surcharges based on payment
   * methods.
   */
  surcharges: Array<Surcharge>;
  /** A summary of the taxes being applied to this Order */
  taxSummary: Array<OrderTaxSummary>;
  /** Equal to subTotal plus shipping */
  total: Scalars['Money']['output'];
  totalQuantity: Scalars['Int']['output'];
  /** The final payable amount. Equal to subTotalWithTax plus shippingWithTax */
  totalWithTax: Scalars['Money']['output'];
  type: OrderType;
  updatedAt: Scalars['DateTime']['output'];
};


export type OrderHistoryArgs = {
  options?: InputMaybe<HistoryEntryListOptions>;
};

export type OrderAddress = {
  city?: Maybe<Scalars['String']['output']>;
  company?: Maybe<Scalars['String']['output']>;
  country?: Maybe<Scalars['String']['output']>;
  countryCode?: Maybe<Scalars['String']['output']>;
  customFields?: Maybe<Scalars['JSON']['output']>;
  fullName?: Maybe<Scalars['String']['output']>;
  phoneNumber?: Maybe<Scalars['String']['output']>;
  postalCode?: Maybe<Scalars['String']['output']>;
  province?: Maybe<Scalars['String']['output']>;
  streetLine1?: Maybe<Scalars['String']['output']>;
  streetLine2?: Maybe<Scalars['String']['output']>;
};

export type OrderCustomFields = {
  dispatchReadinessState?: Maybe<Scalars['String']['output']>;
  juspayOrderId?: Maybe<Scalars['String']['output']>;
};

export type OrderFilterParameter = {
  _and?: InputMaybe<Array<OrderFilterParameter>>;
  _or?: InputMaybe<Array<OrderFilterParameter>>;
  active?: InputMaybe<BooleanOperators>;
  aggregateOrderId?: InputMaybe<IdOperators>;
  code?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  currencyCode?: InputMaybe<StringOperators>;
  customerLastName?: InputMaybe<StringOperators>;
  dispatchReadinessState?: InputMaybe<StringOperators>;
  id?: InputMaybe<IdOperators>;
  juspayOrderId?: InputMaybe<StringOperators>;
  orderPlacedAt?: InputMaybe<DateOperators>;
  shipping?: InputMaybe<NumberOperators>;
  shippingWithTax?: InputMaybe<NumberOperators>;
  state?: InputMaybe<StringOperators>;
  subTotal?: InputMaybe<NumberOperators>;
  subTotalWithTax?: InputMaybe<NumberOperators>;
  total?: InputMaybe<NumberOperators>;
  totalQuantity?: InputMaybe<NumberOperators>;
  totalWithTax?: InputMaybe<NumberOperators>;
  transactionId?: InputMaybe<StringOperators>;
  type?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

/** Returned when an order operation is rejected by an OrderInterceptor method. */
export type OrderInterceptorError = ErrorResult & {
  errorCode: ErrorCode;
  interceptorError: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

/** Returned when the maximum order size limit has been reached. */
export type OrderLimitError = ErrorResult & {
  errorCode: ErrorCode;
  maxItems: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

export type OrderLine = Node & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  /** The price of the line including discounts, excluding tax */
  discountedLinePrice: Scalars['Money']['output'];
  /** The price of the line including discounts and tax */
  discountedLinePriceWithTax: Scalars['Money']['output'];
  /**
   * The price of a single unit including discounts, excluding tax.
   *
   * If Order-level discounts have been applied, this will not be the
   * actual taxable unit price (see `proratedUnitPrice`), but is generally the
   * correct price to display to customers to avoid confusion
   * about the internal handling of distributed Order-level discounts.
   */
  discountedUnitPrice: Scalars['Money']['output'];
  /** The price of a single unit including discounts and tax */
  discountedUnitPriceWithTax: Scalars['Money']['output'];
  discounts: Array<Discount>;
  featuredAsset?: Maybe<Asset>;
  fulfillmentLines?: Maybe<Array<FulfillmentLine>>;
  id: Scalars['ID']['output'];
  /** The total price of the line excluding tax and discounts. */
  linePrice: Scalars['Money']['output'];
  /** The total price of the line including tax but excluding discounts. */
  linePriceWithTax: Scalars['Money']['output'];
  /** The total tax on this line */
  lineTax: Scalars['Money']['output'];
  order: Order;
  /** The quantity at the time the Order was placed */
  orderPlacedQuantity: Scalars['Int']['output'];
  productVariant: ProductVariant;
  /**
   * The actual line price, taking into account both item discounts _and_ prorated (proportionally-distributed)
   * Order-level discounts. This value is the true economic value of the OrderLine, and is used in tax
   * and refund calculations.
   */
  proratedLinePrice: Scalars['Money']['output'];
  /** The proratedLinePrice including tax */
  proratedLinePriceWithTax: Scalars['Money']['output'];
  /**
   * The actual unit price, taking into account both item discounts _and_ prorated (proportionally-distributed)
   * Order-level discounts. This value is the true economic value of the OrderItem, and is used in tax
   * and refund calculations.
   */
  proratedUnitPrice: Scalars['Money']['output'];
  /** The proratedUnitPrice including tax */
  proratedUnitPriceWithTax: Scalars['Money']['output'];
  /** The quantity of items purchased */
  quantity: Scalars['Int']['output'];
  sellerId?: Maybe<Scalars['ID']['output']>;
  sellerName?: Maybe<Scalars['String']['output']>;
  taxLines: Array<TaxLine>;
  taxRate: Scalars['Float']['output'];
  /** The price of a single unit, excluding tax and discounts */
  unitPrice: Scalars['Money']['output'];
  /** Non-zero if the unitPrice has changed since it was initially added to Order */
  unitPriceChangeSinceAdded: Scalars['Money']['output'];
  /** The price of a single unit, including tax but excluding discounts */
  unitPriceWithTax: Scalars['Money']['output'];
  /** Non-zero if the unitPriceWithTax has changed since it was initially added to Order */
  unitPriceWithTaxChangeSinceAdded: Scalars['Money']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type OrderLineInput = {
  orderLineId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
};

export type OrderList = PaginatedList & {
  items: Array<Order>;
  totalItems: Scalars['Int']['output'];
};

export type OrderListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<OrderFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<OrderSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type OrderModification = Node & {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  isSettled: Scalars['Boolean']['output'];
  lines: Array<OrderModificationLine>;
  note: Scalars['String']['output'];
  payment?: Maybe<Payment>;
  priceChange: Scalars['Money']['output'];
  refund?: Maybe<Refund>;
  surcharges?: Maybe<Array<Surcharge>>;
  updatedAt: Scalars['DateTime']['output'];
};

/** Returned when attempting to modify the contents of an Order that is not in the `AddingItems` state. */
export type OrderModificationError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type OrderModificationLine = {
  modification: OrderModification;
  modificationId: Scalars['ID']['output'];
  orderLine: OrderLine;
  orderLineId: Scalars['ID']['output'];
  quantity: Scalars['Int']['output'];
};

/** Returned when attempting to modify the contents of an Order that is not in the `Modifying` state. */
export type OrderModificationStateError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type OrderProcessState = {
  name: Scalars['String']['output'];
  to: Array<Scalars['String']['output']>;
};

export type OrderSortParameter = {
  aggregateOrderId?: InputMaybe<SortOrder>;
  code?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  customerLastName?: InputMaybe<SortOrder>;
  dispatchReadinessState?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  juspayOrderId?: InputMaybe<SortOrder>;
  orderPlacedAt?: InputMaybe<SortOrder>;
  shipping?: InputMaybe<SortOrder>;
  shippingWithTax?: InputMaybe<SortOrder>;
  state?: InputMaybe<SortOrder>;
  subTotal?: InputMaybe<SortOrder>;
  subTotalWithTax?: InputMaybe<SortOrder>;
  total?: InputMaybe<SortOrder>;
  totalQuantity?: InputMaybe<SortOrder>;
  totalWithTax?: InputMaybe<SortOrder>;
  transactionId?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

/** Returned if there is an error in transitioning the Order state */
export type OrderStateTransitionError = ErrorResult & {
  errorCode: ErrorCode;
  fromState: Scalars['String']['output'];
  message: Scalars['String']['output'];
  toState: Scalars['String']['output'];
  transitionError: Scalars['String']['output'];
};

/**
 * A summary of the taxes being applied to this order, grouped
 * by taxRate.
 */
export type OrderTaxSummary = {
  /** A description of this tax */
  description: Scalars['String']['output'];
  /** The total net price of OrderLines to which this taxRate applies */
  taxBase: Scalars['Money']['output'];
  /** The taxRate as a percentage */
  taxRate: Scalars['Float']['output'];
  /** The total tax being applied to the Order at this taxRate */
  taxTotal: Scalars['Money']['output'];
};

export type OrderType =
  | 'Aggregate'
  | 'Regular'
  | 'Seller';

export type PaginatedList = {
  items: Array<Node>;
  totalItems: Scalars['Int']['output'];
};

export type Payment = Node & {
  amount: Scalars['Money']['output'];
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  errorMessage?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  method: Scalars['String']['output'];
  nextStates: Array<Scalars['String']['output']>;
  refunds: Array<Refund>;
  state: Scalars['String']['output'];
  transactionId?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type PaymentMethod = Node & {
  checker?: Maybe<ConfigurableOperation>;
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  description: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  handler: ConfigurableOperation;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  translations: Array<PaymentMethodTranslation>;
  updatedAt: Scalars['DateTime']['output'];
};

export type PaymentMethodFilterParameter = {
  _and?: InputMaybe<Array<PaymentMethodFilterParameter>>;
  _or?: InputMaybe<Array<PaymentMethodFilterParameter>>;
  code?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  description?: InputMaybe<StringOperators>;
  enabled?: InputMaybe<BooleanOperators>;
  id?: InputMaybe<IdOperators>;
  name?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type PaymentMethodList = PaginatedList & {
  items: Array<PaymentMethod>;
  totalItems: Scalars['Int']['output'];
};

export type PaymentMethodListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<PaymentMethodFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<PaymentMethodSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

/**
 * Returned when a call to modifyOrder fails to include a paymentMethod even
 * though the price has increased as a result of the changes.
 */
export type PaymentMethodMissingError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type PaymentMethodQuote = {
  code: Scalars['String']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  description: Scalars['String']['output'];
  eligibilityMessage?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isEligible: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
};

export type PaymentMethodSortParameter = {
  code?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  description?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type PaymentMethodTranslation = {
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type PaymentMethodTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
};

/** Returned if an attempting to refund a Payment against OrderLines from a different Order */
export type PaymentOrderMismatchError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/** Returned when there is an error in transitioning the Payment state */
export type PaymentStateTransitionError = ErrorResult & {
  errorCode: ErrorCode;
  fromState: Scalars['String']['output'];
  message: Scalars['String']['output'];
  toState: Scalars['String']['output'];
  transitionError: Scalars['String']['output'];
};

export type PayoutStatus =
  | 'CANCELLED'
  | 'FAILED'
  | 'PENDING'
  | 'PROCESSING'
  | 'REVERSED'
  | 'SETTLED';

/**
 * @description
 * Permissions for administrators and customers. Used to control access to
 * GraphQL resolvers via the {@link Allow} decorator.
 *
 * ## Understanding Permission.Owner
 *
 * `Permission.Owner` is a special permission which is used in some Vendure resolvers to indicate that that resolver should only
 * be accessible to the "owner" of that resource.
 *
 * For example, the Shop API `activeCustomer` query resolver should only return the Customer object for the "owner" of that Customer, i.e.
 * based on the activeUserId of the current session. As a result, the resolver code looks like this:
 *
 * @example
 * ```TypeScript
 * \@Query()
 * \@Allow(Permission.Owner)
 * async activeCustomer(\@Ctx() ctx: RequestContext): Promise<Customer | undefined> {
 *   const userId = ctx.activeUserId;
 *   if (userId) {
 *     return this.customerService.findOneByUserId(ctx, userId);
 *   }
 * }
 * ```
 *
 * Here we can see that the "ownership" must be enforced by custom logic inside the resolver. Since "ownership" cannot be defined generally
 * nor statically encoded at build-time, any resolvers using `Permission.Owner` **must** include logic to enforce that only the owner
 * of the resource has access. If not, then it is the equivalent of using `Permission.Public`.
 *
 *
 * @docsCategory common
 */
export type Permission =
  /** Authenticated means simply that the user is logged in */
  | 'Authenticated'
  /** Grants permission to create Administrator */
  | 'CreateAdministrator'
  /** Grants permission to create Asset */
  | 'CreateAsset'
  /** Grants permission to create Products, Facets, Assets, Collections */
  | 'CreateCatalog'
  /** Grants permission to create Channel */
  | 'CreateChannel'
  /** Grants permission to create Collection */
  | 'CreateCollection'
  /** Grants permission to create Country */
  | 'CreateCountry'
  /** Grants permission to create Customer */
  | 'CreateCustomer'
  /** Grants permission to create CustomerGroup */
  | 'CreateCustomerGroup'
  /** Grants permission to create Facet */
  | 'CreateFacet'
  /** Grants permission to create Order */
  | 'CreateOrder'
  /** Grants permission to create PaymentMethod */
  | 'CreatePaymentMethod'
  /** Grants permission to create Product */
  | 'CreateProduct'
  /** Grants permission to create Promotion */
  | 'CreatePromotion'
  /** Grants permission to create Seller */
  | 'CreateSeller'
  /** Grants permission to create PaymentMethods, ShippingMethods, TaxCategories, TaxRates, Zones, Countries, System & GlobalSettings */
  | 'CreateSettings'
  /** Grants permission to create ShippingMethod */
  | 'CreateShippingMethod'
  /** Grants permission to create StockLocation */
  | 'CreateStockLocation'
  /** Grants permission to create System */
  | 'CreateSystem'
  /** Grants permission to create Tag */
  | 'CreateTag'
  /** Grants permission to create TaxCategory */
  | 'CreateTaxCategory'
  /** Grants permission to create TaxRate */
  | 'CreateTaxRate'
  /** Grants permission to create Zone */
  | 'CreateZone'
  /** Grants permission to delete Administrator */
  | 'DeleteAdministrator'
  /** Grants permission to delete Asset */
  | 'DeleteAsset'
  /** Grants permission to delete Products, Facets, Assets, Collections */
  | 'DeleteCatalog'
  /** Grants permission to delete Channel */
  | 'DeleteChannel'
  /** Grants permission to delete Collection */
  | 'DeleteCollection'
  /** Grants permission to delete Country */
  | 'DeleteCountry'
  /** Grants permission to delete Customer */
  | 'DeleteCustomer'
  /** Grants permission to delete CustomerGroup */
  | 'DeleteCustomerGroup'
  /** Grants permission to delete Facet */
  | 'DeleteFacet'
  /** Grants permission to delete Order */
  | 'DeleteOrder'
  /** Grants permission to delete PaymentMethod */
  | 'DeletePaymentMethod'
  /** Grants permission to delete Product */
  | 'DeleteProduct'
  /** Grants permission to delete Promotion */
  | 'DeletePromotion'
  /** Grants permission to delete Seller */
  | 'DeleteSeller'
  /** Grants permission to delete PaymentMethods, ShippingMethods, TaxCategories, TaxRates, Zones, Countries, System & GlobalSettings */
  | 'DeleteSettings'
  /** Grants permission to delete ShippingMethod */
  | 'DeleteShippingMethod'
  /** Grants permission to delete StockLocation */
  | 'DeleteStockLocation'
  /** Grants permission to delete System */
  | 'DeleteSystem'
  /** Grants permission to delete Tag */
  | 'DeleteTag'
  /** Grants permission to delete TaxCategory */
  | 'DeleteTaxCategory'
  /** Grants permission to delete TaxRate */
  | 'DeleteTaxRate'
  /** Grants permission to delete Zone */
  | 'DeleteZone'
  /** Permission to manage cashback policies for own seller channel */
  | 'ManageSellerCashback'
  /** Allows the seller to pause or resume their own storefront */
  | 'ManageSellerOperationalStatus'
  /** Allows a seller to create and manage their own promotion campaigns */
  | 'ManageSellerPromotion'
  /** Allows managing promotion billing */
  | 'ManageSellerPromotionBilling'
  /** Owner means the user owns this entity, e.g. a Customer's own Order */
  | 'Owner'
  /** Public means any unauthenticated user may perform the operation */
  | 'Public'
  /** Grants permission to read Administrator */
  | 'ReadAdministrator'
  /** Grants permission to read Asset */
  | 'ReadAsset'
  /** Grants permission to read Products, Facets, Assets, Collections */
  | 'ReadCatalog'
  /** Grants permission to read Channel */
  | 'ReadChannel'
  /** Grants permission to read Collection */
  | 'ReadCollection'
  /** Grants permission to read Country */
  | 'ReadCountry'
  /** Grants permission to read Customer */
  | 'ReadCustomer'
  /** Grants permission to read CustomerGroup */
  | 'ReadCustomerGroup'
  /** Grants permission to read Facet */
  | 'ReadFacet'
  /** Grants permission to read Order */
  | 'ReadOrder'
  /** Grants permission to read PaymentMethod */
  | 'ReadPaymentMethod'
  /** Grants permission to read Product */
  | 'ReadProduct'
  /** Grants permission to read Promotion */
  | 'ReadPromotion'
  /** Grants permission to read Seller */
  | 'ReadSeller'
  /** Allows reading promotion analytics (admin + seller) */
  | 'ReadSellerPromotionAnalytics'
  /** Grants permission to read PaymentMethods, ShippingMethods, TaxCategories, TaxRates, Zones, Countries, System & GlobalSettings */
  | 'ReadSettings'
  /** Grants permission to read ShippingMethod */
  | 'ReadShippingMethod'
  /** Grants permission to read StockLocation */
  | 'ReadStockLocation'
  /** Grants permission to read System */
  | 'ReadSystem'
  /** Grants permission to read Tag */
  | 'ReadTag'
  /** Grants permission to read TaxCategory */
  | 'ReadTaxCategory'
  /** Grants permission to read TaxRate */
  | 'ReadTaxRate'
  /** Grants permission to read Zone */
  | 'ReadZone'
  /** Allows setting a webhook URL */
  | 'SetWebhook'
  /** SuperAdmin has unrestricted access to all operations */
  | 'SuperAdmin'
  /** Grants permission to update Administrator */
  | 'UpdateAdministrator'
  /** Grants permission to update Asset */
  | 'UpdateAsset'
  /** Grants permission to update Products, Facets, Assets, Collections */
  | 'UpdateCatalog'
  /** Grants permission to update Channel */
  | 'UpdateChannel'
  /** Grants permission to update Collection */
  | 'UpdateCollection'
  /** Grants permission to update Country */
  | 'UpdateCountry'
  /** Grants permission to update Customer */
  | 'UpdateCustomer'
  /** Grants permission to update CustomerGroup */
  | 'UpdateCustomerGroup'
  /** Grants permission to update Facet */
  | 'UpdateFacet'
  /** Grants permission to update GlobalSettings */
  | 'UpdateGlobalSettings'
  /** Grants permission to update Order */
  | 'UpdateOrder'
  /** Grants permission to update PaymentMethod */
  | 'UpdatePaymentMethod'
  /** Grants permission to update Product */
  | 'UpdateProduct'
  /** Grants permission to update Promotion */
  | 'UpdatePromotion'
  /** Grants permission to update Seller */
  | 'UpdateSeller'
  /** Grants permission to update PaymentMethods, ShippingMethods, TaxCategories, TaxRates, Zones, Countries, System & GlobalSettings */
  | 'UpdateSettings'
  /** Grants permission to update ShippingMethod */
  | 'UpdateShippingMethod'
  /** Grants permission to update StockLocation */
  | 'UpdateStockLocation'
  /** Grants permission to update System */
  | 'UpdateSystem'
  /** Grants permission to update Tag */
  | 'UpdateTag'
  /** Grants permission to update TaxCategory */
  | 'UpdateTaxCategory'
  /** Grants permission to update TaxRate */
  | 'UpdateTaxRate'
  /** Grants permission to update Zone */
  | 'UpdateZone';

export type PermissionDefinition = {
  assignable: Scalars['Boolean']['output'];
  description: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type PreviewCollectionVariantsInput = {
  filters: Array<ConfigurableOperationInput>;
  inheritFilters: Scalars['Boolean']['input'];
  parentId?: InputMaybe<Scalars['ID']['input']>;
};

/** The price range where the result has more than one price */
export type PriceRange = {
  max: Scalars['Money']['output'];
  min: Scalars['Money']['output'];
};

export type PriceRangeBucket = {
  count: Scalars['Int']['output'];
  to: Scalars['Int']['output'];
};

export type PriceRangeInput = {
  max: Scalars['Int']['input'];
  min: Scalars['Int']['input'];
};

export type Product = Node & {
  assets: Array<Asset>;
  channels: Array<Channel>;
  collections: Array<Collection>;
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<ProductCustomFields>;
  description: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  facetValues: Array<FacetValue>;
  featuredAsset?: Maybe<Asset>;
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  optionGroups: Array<ProductOptionGroup>;
  reviews: ProductReviewList;
  reviewsHistogram: Array<ProductReviewHistogramItem>;
  slug: Scalars['String']['output'];
  translations: Array<ProductTranslation>;
  updatedAt: Scalars['DateTime']['output'];
  /** Returns a paginated, sortable, filterable list of ProductVariants */
  variantList: ProductVariantList;
  /** Returns all ProductVariants */
  variants: Array<ProductVariant>;
};


export type ProductReviewsArgs = {
  options?: InputMaybe<ProductReviewListOptions>;
};


export type ProductVariantListArgs = {
  options?: InputMaybe<ProductVariantListOptions>;
};

export type ProductCustomFields = {
  sellerIsVerified?: Maybe<Scalars['Boolean']['output']>;
  sellerOnboardingStatus?: Maybe<Scalars['String']['output']>;
  sellerOperationalStatus?: Maybe<Scalars['String']['output']>;
  sellerPromotionActive?: Maybe<Scalars['Boolean']['output']>;
  sellerPromotionBannerEligible?: Maybe<Scalars['Boolean']['output']>;
  sellerPromotionBidBoost?: Maybe<Scalars['Int']['output']>;
  sellerPromotionCampaignId?: Maybe<Scalars['String']['output']>;
  sellerPromotionScore?: Maybe<Scalars['Int']['output']>;
};

export type ProductFilterParameter = {
  _and?: InputMaybe<Array<ProductFilterParameter>>;
  _or?: InputMaybe<Array<ProductFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  description?: InputMaybe<StringOperators>;
  enabled?: InputMaybe<BooleanOperators>;
  facetValueId?: InputMaybe<IdOperators>;
  id?: InputMaybe<IdOperators>;
  languageCode?: InputMaybe<StringOperators>;
  name?: InputMaybe<StringOperators>;
  sellerIsVerified?: InputMaybe<BooleanOperators>;
  sellerOnboardingStatus?: InputMaybe<StringOperators>;
  sellerOperationalStatus?: InputMaybe<StringOperators>;
  sellerPromotionActive?: InputMaybe<BooleanOperators>;
  sellerPromotionBannerEligible?: InputMaybe<BooleanOperators>;
  sellerPromotionBidBoost?: InputMaybe<NumberOperators>;
  sellerPromotionCampaignId?: InputMaybe<StringOperators>;
  sellerPromotionScore?: InputMaybe<NumberOperators>;
  sku?: InputMaybe<StringOperators>;
  slug?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type ProductList = PaginatedList & {
  items: Array<Product>;
  totalItems: Scalars['Int']['output'];
};

export type ProductListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<ProductFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<ProductSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type ProductOption = Node & {
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  group: ProductOptionGroup;
  groupId: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  translations: Array<ProductOptionTranslation>;
  updatedAt: Scalars['DateTime']['output'];
};

export type ProductOptionFilterParameter = {
  _and?: InputMaybe<Array<ProductOptionFilterParameter>>;
  _or?: InputMaybe<Array<ProductOptionFilterParameter>>;
  code?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  groupId?: InputMaybe<IdOperators>;
  id?: InputMaybe<IdOperators>;
  languageCode?: InputMaybe<StringOperators>;
  name?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type ProductOptionGroup = Node & {
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  options: Array<ProductOption>;
  translations: Array<ProductOptionGroupTranslation>;
  updatedAt: Scalars['DateTime']['output'];
};

export type ProductOptionGroupTranslation = {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ProductOptionGroupTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type ProductOptionInUseError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
  optionGroupCode: Scalars['String']['output'];
  productVariantCount: Scalars['Int']['output'];
};

export type ProductOptionList = PaginatedList & {
  items: Array<ProductOption>;
  totalItems: Scalars['Int']['output'];
};

export type ProductOptionListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<ProductOptionFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<ProductOptionSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type ProductOptionSortParameter = {
  code?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  groupId?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type ProductOptionTranslation = {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ProductOptionTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type ProductReview = Node & {
  assets?: Maybe<Array<Asset>>;
  author?: Maybe<Customer>;
  authorLocation?: Maybe<Scalars['String']['output']>;
  authorName: Scalars['String']['output'];
  body?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  downvotes: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  incentivized: Scalars['Boolean']['output'];
  product: Product;
  productVariant?: Maybe<ProductVariant>;
  rating: Scalars['Float']['output'];
  response?: Maybe<Scalars['String']['output']>;
  responseCreatedAt?: Maybe<Scalars['DateTime']['output']>;
  state: Scalars['String']['output'];
  summary: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  upvotes: Scalars['Int']['output'];
  userVote?: Maybe<Scalars['String']['output']>;
  verifiedPurchase: Scalars['Boolean']['output'];
};

export type ProductReviewFilterInput = {
  authorName?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  rating?: InputMaybe<NumberOperators>;
  state?: InputMaybe<StringOperators>;
};

export type ProductReviewHistogramItem = {
  bin: Scalars['Int']['output'];
  frequency: Scalars['Int']['output'];
};

export type ProductReviewList = PaginatedList & {
  items: Array<ProductReview>;
  totalItems: Scalars['Int']['output'];
};

export type ProductReviewListOptions = {
  filter?: InputMaybe<ProductReviewFilterInput>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  sort?: InputMaybe<ProductReviewSortInput>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type ProductReviewSortInput = {
  createdAt?: InputMaybe<SortOrder>;
  rating?: InputMaybe<SortOrder>;
  upvotes?: InputMaybe<SortOrder>;
};

export type ProductSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  description?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  sellerIsVerified?: InputMaybe<SortOrder>;
  sellerOnboardingStatus?: InputMaybe<SortOrder>;
  sellerOperationalStatus?: InputMaybe<SortOrder>;
  sellerPromotionActive?: InputMaybe<SortOrder>;
  sellerPromotionBannerEligible?: InputMaybe<SortOrder>;
  sellerPromotionBidBoost?: InputMaybe<SortOrder>;
  sellerPromotionCampaignId?: InputMaybe<SortOrder>;
  sellerPromotionScore?: InputMaybe<SortOrder>;
  slug?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type ProductTranslation = {
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ProductTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
};

export type ProductVariant = Node & {
  assets: Array<Asset>;
  channels: Array<Channel>;
  createdAt: Scalars['DateTime']['output'];
  currencyCode: CurrencyCode;
  customFields?: Maybe<Scalars['JSON']['output']>;
  enabled: Scalars['Boolean']['output'];
  facetValues: Array<FacetValue>;
  featuredAsset?: Maybe<Asset>;
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  options: Array<ProductOption>;
  outOfStockThreshold: Scalars['Int']['output'];
  price: Scalars['Money']['output'];
  priceWithTax: Scalars['Money']['output'];
  prices: Array<ProductVariantPrice>;
  product: Product;
  productId: Scalars['ID']['output'];
  sku: Scalars['String']['output'];
  /** @deprecated use stockLevels */
  stockAllocated: Scalars['Int']['output'];
  stockLevel: Scalars['String']['output'];
  stockLevels: Array<StockLevel>;
  stockMovements: StockMovementList;
  /** @deprecated use stockLevels */
  stockOnHand: Scalars['Int']['output'];
  taxCategory: TaxCategory;
  taxRateApplied: TaxRate;
  trackInventory: GlobalFlag;
  translations: Array<ProductVariantTranslation>;
  updatedAt: Scalars['DateTime']['output'];
  useGlobalOutOfStockThreshold: Scalars['Boolean']['output'];
};


export type ProductVariantStockMovementsArgs = {
  options?: InputMaybe<StockMovementListOptions>;
};

export type ProductVariantCashbackPolicy = {
  createdAt: Scalars['DateTime']['output'];
  currencyCode: Scalars['String']['output'];
  endsAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  maxEarnPerLinePaise?: Maybe<Scalars['Int']['output']>;
  productVariantId: Scalars['ID']['output'];
  rateType: Scalars['String']['output'];
  rateValue: Scalars['Int']['output'];
  sellerId: Scalars['ID']['output'];
  startsAt?: Maybe<Scalars['DateTime']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type ProductVariantCashbackPolicyList = {
  items: Array<ProductVariantCashbackPolicy>;
  totalItems: Scalars['Int']['output'];
};

export type ProductVariantFilterParameter = {
  _and?: InputMaybe<Array<ProductVariantFilterParameter>>;
  _or?: InputMaybe<Array<ProductVariantFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  currencyCode?: InputMaybe<StringOperators>;
  enabled?: InputMaybe<BooleanOperators>;
  facetValueId?: InputMaybe<IdOperators>;
  id?: InputMaybe<IdOperators>;
  languageCode?: InputMaybe<StringOperators>;
  name?: InputMaybe<StringOperators>;
  outOfStockThreshold?: InputMaybe<NumberOperators>;
  price?: InputMaybe<NumberOperators>;
  priceWithTax?: InputMaybe<NumberOperators>;
  productId?: InputMaybe<IdOperators>;
  sku?: InputMaybe<StringOperators>;
  stockAllocated?: InputMaybe<NumberOperators>;
  stockLevel?: InputMaybe<StringOperators>;
  stockOnHand?: InputMaybe<NumberOperators>;
  trackInventory?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
  useGlobalOutOfStockThreshold?: InputMaybe<BooleanOperators>;
};

export type ProductVariantList = PaginatedList & {
  items: Array<ProductVariant>;
  totalItems: Scalars['Int']['output'];
};

export type ProductVariantListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<ProductVariantFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<ProductVariantSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type ProductVariantPrice = {
  currencyCode: CurrencyCode;
  customFields?: Maybe<Scalars['JSON']['output']>;
  price: Scalars['Money']['output'];
};

export type ProductVariantSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  outOfStockThreshold?: InputMaybe<SortOrder>;
  price?: InputMaybe<SortOrder>;
  priceWithTax?: InputMaybe<SortOrder>;
  productId?: InputMaybe<SortOrder>;
  sku?: InputMaybe<SortOrder>;
  stockAllocated?: InputMaybe<SortOrder>;
  stockLevel?: InputMaybe<SortOrder>;
  stockOnHand?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type ProductVariantTranslation = {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ProductVariantTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type Promotion = Node & {
  actions: Array<ConfigurableOperation>;
  conditions: Array<ConfigurableOperation>;
  couponCode?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  description: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  endsAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  perCustomerUsageLimit?: Maybe<Scalars['Int']['output']>;
  startsAt?: Maybe<Scalars['DateTime']['output']>;
  translations: Array<PromotionTranslation>;
  updatedAt: Scalars['DateTime']['output'];
  usageLimit?: Maybe<Scalars['Int']['output']>;
};

export type PromotionAggregateReport = {
  attributedOrders: Scalars['Int']['output'];
  attributedRevenue: Scalars['Int']['output'];
  clicks: Scalars['Int']['output'];
  ctr: Scalars['Float']['output'];
  hourly: Array<PromotionMetricHourly>;
  impressions: Scalars['Int']['output'];
  roas: Scalars['Float']['output'];
  spend: Scalars['Int']['output'];
};

export type PromotionBillingAccount = {
  channelId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  currencyCode: Scalars['String']['output'];
  currentBalance: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  sellerId: Scalars['ID']['output'];
  status: PromotionBillingAccountStatus;
  updatedAt: Scalars['DateTime']['output'];
};

export type PromotionBillingAccountStatus =
  | 'ACTIVE'
  | 'SUSPENDED';

export type PromotionCampaignReport = {
  attributedOrders: Scalars['Int']['output'];
  attributedRevenue: Scalars['Int']['output'];
  campaignId: Scalars['ID']['output'];
  clicks: Scalars['Int']['output'];
  ctr: Scalars['Float']['output'];
  from: Scalars['DateTime']['output'];
  hourly: Array<PromotionMetricHourly>;
  impressions: Scalars['Int']['output'];
  roas: Scalars['Float']['output'];
  spend: Scalars['Int']['output'];
  to: Scalars['DateTime']['output'];
};

export type PromotionFilterParameter = {
  _and?: InputMaybe<Array<PromotionFilterParameter>>;
  _or?: InputMaybe<Array<PromotionFilterParameter>>;
  couponCode?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  description?: InputMaybe<StringOperators>;
  enabled?: InputMaybe<BooleanOperators>;
  endsAt?: InputMaybe<DateOperators>;
  id?: InputMaybe<IdOperators>;
  name?: InputMaybe<StringOperators>;
  perCustomerUsageLimit?: InputMaybe<NumberOperators>;
  startsAt?: InputMaybe<DateOperators>;
  updatedAt?: InputMaybe<DateOperators>;
  usageLimit?: InputMaybe<NumberOperators>;
};

export type PromotionLedgerEntry = {
  accountId: Scalars['ID']['output'];
  amount: Scalars['Int']['output'];
  balanceAfter: Scalars['Int']['output'];
  campaignId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  entryType: PromotionLedgerEntryType;
  id: Scalars['ID']['output'];
  idempotencyKey: Scalars['String']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  reference?: Maybe<Scalars['String']['output']>;
};

export type PromotionLedgerEntryList = {
  items: Array<PromotionLedgerEntry>;
  totalItems: Scalars['Int']['output'];
};

export type PromotionLedgerEntryType =
  | 'ADJUSTMENT'
  | 'CREDIT'
  | 'DEBIT'
  | 'HOLD'
  | 'INTENT'
  | 'REFUND'
  | 'RELEASE';

export type PromotionList = PaginatedList & {
  items: Array<Promotion>;
  totalItems: Scalars['Int']['output'];
};

export type PromotionListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<PromotionFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<PromotionSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type PromotionMetricHourly = {
  attributedOrders: Scalars['Int']['output'];
  attributedRevenue: Scalars['Int']['output'];
  clicks: Scalars['Int']['output'];
  hourBucket: Scalars['DateTime']['output'];
  impressions: Scalars['Int']['output'];
  spend: Scalars['Int']['output'];
};

export type PromotionPlan = {
  analyticsTier: Scalars['String']['output'];
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  maxActiveCampaigns: Scalars['Int']['output'];
  maxBoostScore: Scalars['Int']['output'];
  maxDailyBudget?: Maybe<Scalars['Int']['output']>;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type PromotionPlanAssignment = {
  channelId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  planId: Scalars['ID']['output'];
  renewsAt?: Maybe<Scalars['DateTime']['output']>;
  sellerId: Scalars['ID']['output'];
  startsAt: Scalars['DateTime']['output'];
  status: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type PromotionReportRangeInput = {
  from: Scalars['DateTime']['input'];
  to: Scalars['DateTime']['input'];
};

export type PromotionSortParameter = {
  couponCode?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  description?: InputMaybe<SortOrder>;
  endsAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  perCustomerUsageLimit?: InputMaybe<SortOrder>;
  startsAt?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
  usageLimit?: InputMaybe<SortOrder>;
};

export type PromotionTopupConfirmation = {
  amountCaptured: Scalars['Int']['output'];
  currencyCode: Scalars['String']['output'];
  intentId: Scalars['String']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  provider: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type PromotionTopupIntent = {
  clientToken?: Maybe<Scalars['String']['output']>;
  intentId: Scalars['String']['output'];
  provider: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type PromotionTranslation = {
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type PromotionTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type Province = Node & Region & {
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  parent?: Maybe<Region>;
  parentId?: Maybe<Scalars['ID']['output']>;
  translations: Array<RegionTranslation>;
  type: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ProvinceFilterParameter = {
  _and?: InputMaybe<Array<ProvinceFilterParameter>>;
  _or?: InputMaybe<Array<ProvinceFilterParameter>>;
  code?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  enabled?: InputMaybe<BooleanOperators>;
  id?: InputMaybe<IdOperators>;
  languageCode?: InputMaybe<StringOperators>;
  name?: InputMaybe<StringOperators>;
  parentId?: InputMaybe<IdOperators>;
  type?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type ProvinceList = PaginatedList & {
  items: Array<Province>;
  totalItems: Scalars['Int']['output'];
};

export type ProvinceListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<ProvinceFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<ProvinceSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type ProvinceSortParameter = {
  code?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  parentId?: InputMaybe<SortOrder>;
  type?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type ProvinceTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
};

/** Returned if the specified quantity of an OrderLine is greater than the number of items in that line */
export type QuantityTooGreatError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

export type Query = {
  activeAdministrator?: Maybe<Administrator>;
  activeChannel: Channel;
  adminGeoCacheStats: GeoCacheStats;
  adminGeoMetrics: GeoMetrics;
  /**  Admin: all ledger entries for a specific account  */
  adminPromotionLedgerEntries: PromotionLedgerEntryList;
  administrator?: Maybe<Administrator>;
  administrators: AdministratorList;
  allSellerCashbackPolicies: Array<SellerCashbackPolicy>;
  /**  Aggregator: all variant policies across all sellers  */
  allVariantCashbackPolicies: ProductVariantCashbackPolicyList;
  /** Get a single Asset by id */
  asset?: Maybe<Asset>;
  /** Get a list of Assets */
  assets: AssetList;
  /** Get all available Vendure events that can be used to trigger webhooks */
  availableWebhookEvents: Array<Scalars['String']['output']>;
  /**
   * "
   * Get all available webhook request transformers
   */
  availableWebhookRequestTransformers: Array<WebhookRequestTransformer>;
  bbbCapacityGrants: Array<BbbCapacityGrant>;
  bbbMeeting?: Maybe<BbbMeeting>;
  bbbMeetings: BbbMeetingList;
  bbbModeratorJoinUrl: Scalars['String']['output'];
  bbbOrganization?: Maybe<BbbOrganization>;
  bbbOrganizationMember?: Maybe<BbbOrganizationMember>;
  bbbOrganizationMembers: BbbOrganizationMemberList;
  bbbOrganizations: BbbOrganizationList;
  bbbRoom?: Maybe<BbbRoom>;
  bbbRooms: BbbRoomList;
  bbbScheduledSessions: Array<BbbScheduledSession>;
  bbbServer?: Maybe<BbbServer>;
  bbbServers: BbbServerList;
  canReviewProduct: ReviewEligibilityResult;
  cashbackMarketplaceMetrics: CashbackMarketplaceMetrics;
  cashbackTransactions: CashbackTransactionList;
  channel?: Maybe<Channel>;
  channels: ChannelList;
  /** Get a Collection either by id or slug. If neither id nor slug is specified, an error will result. */
  collection?: Maybe<Collection>;
  collectionFilters: Array<ConfigurableOperationDefinition>;
  collections: CollectionList;
  countries: CountryList;
  country?: Maybe<Country>;
  customer?: Maybe<Customer>;
  customerCashbackWallet?: Maybe<CustomerCashbackWallet>;
  customerGroup?: Maybe<CustomerGroup>;
  customerGroups: CustomerGroupList;
  customers: CustomerList;
  deliveryAssignment?: Maybe<DeliveryAssignmentRecord>;
  deliveryAssignments: DeliveryAssignmentList;
  deliveryStats: DeliveryStatsResult;
  /** Returns a list of eligible shipping methods for the draft Order */
  eligibleShippingMethodsForDraftOrder: Array<ShippingMethodQuote>;
  /** Returns all configured EntityDuplicators. */
  entityDuplicators: Array<EntityDuplicatorDefinition>;
  facet?: Maybe<Facet>;
  facetValue?: Maybe<FacetValue>;
  facetValues: FacetValueList;
  facets: FacetList;
  failedDeliveries: Array<DeliveryAssignmentRecord>;
  fulfillmentHandlers: Array<ConfigurableOperationDefinition>;
  /** Get value for a specific key (automatically scoped based on field configuration) */
  getSettingsStoreValue?: Maybe<Scalars['JSON']['output']>;
  /** Get multiple key-value pairs (each automatically scoped) */
  getSettingsStoreValues?: Maybe<Scalars['JSON']['output']>;
  globalSettings: GlobalSettings;
  job?: Maybe<Job>;
  jobBufferSize: Array<JobBufferSize>;
  jobQueues: Array<JobQueue>;
  jobs: JobList;
  jobsById: Array<Job>;
  me?: Maybe<CurrentUser>;
  /** Get metrics for the given interval and metric types. */
  metricSummary: Array<MetricSummary>;
  myCashbackPolicy?: Maybe<SellerCashbackPolicy>;
  myPayouts?: Maybe<SellerPayoutList>;
  /**  Seller: my billing account  */
  myPromotionBillingAccount?: Maybe<PromotionBillingAccount>;
  /**  Seller: my ledger entries  */
  myPromotionLedgerEntries: PromotionLedgerEntryList;
  myRedemptionConfig?: Maybe<SellerCashbackRedemptionConfig>;
  /**
   * Seller self-service revenue dashboard.
   * Only returns data for the authenticated seller's channel.
   */
  mySellerDashboard: SellerDashboardSummary;
  mySellerOperationsProfile?: Maybe<SellerOperationsProfile>;
  myVariantCashbackPolicies: ProductVariantCashbackPolicyList;
  order?: Maybe<Order>;
  orders: OrderList;
  paymentMethod?: Maybe<PaymentMethod>;
  paymentMethodEligibilityCheckers: Array<ConfigurableOperationDefinition>;
  paymentMethodHandlers: Array<ConfigurableOperationDefinition>;
  paymentMethods: PaymentMethodList;
  pendingDeliveries: Array<DeliveryAssignmentRecord>;
  pendingReviewRequests: ReviewRequestList;
  pendingSearchIndexUpdates: Scalars['Int']['output'];
  /** Used for real-time previews of the contents of a Collection */
  previewCollectionVariants: ProductVariantList;
  /** Preview taxonomy suggestions for a category without applying — admin reviews before confirming */
  previewSellerTaxonomySuggestion: TaxonomySuggestion;
  /** Get a Product either by id or slug. If neither id nor slug is specified, an error will result. */
  product?: Maybe<Product>;
  productOption?: Maybe<ProductOption>;
  productOptionGroup?: Maybe<ProductOptionGroup>;
  productOptionGroups: Array<ProductOptionGroup>;
  productOptions: ProductOptionList;
  productReview?: Maybe<ProductReview>;
  productReviews: ProductReviewList;
  /** Get a ProductVariant by id */
  productVariant?: Maybe<ProductVariant>;
  /** List ProductVariants either all or for the specific product. */
  productVariants: ProductVariantList;
  /** List Products */
  products: ProductList;
  promotion?: Maybe<Promotion>;
  promotionActions: Array<ConfigurableOperationDefinition>;
  /**  Analytics: aggregate report across all campaigns in a date range  */
  promotionAggregateReport: PromotionAggregateReport;
  /**  Analytics: hourly rollup report for a campaign  */
  promotionCampaignReport: PromotionCampaignReport;
  promotionConditions: Array<ConfigurableOperationDefinition>;
  /**  Plans: list all enabled plans  */
  promotionPlans: Array<PromotionPlan>;
  promotions: PromotionList;
  province?: Maybe<Province>;
  provinces: ProvinceList;
  role?: Maybe<Role>;
  roles: RoleList;
  scheduledTasks: Array<ScheduledTask>;
  search: SearchResponse;
  seller?: Maybe<Seller>;
  sellerCashbackPolicy?: Maybe<SellerCashbackPolicy>;
  /** Phase 3 — List all category policies */
  sellerCategoryPolicies: Array<SellerCategoryPolicy>;
  /** Phase 3 — Get a single category policy by ID */
  sellerCategoryPolicy?: Maybe<SellerCategoryPolicy>;
  /** Phase 2 — Fetch collection tree for building the tree selector UI */
  sellerCollectionTree: Array<CollectionTreeNode>;
  sellerLifecycleState?: Maybe<SellerLifecycleState>;
  sellerOperationsProfile?: Maybe<SellerOperationsProfile>;
  sellerOrderFulfillmentPlan?: Maybe<SellerOrderFulfillmentPlan>;
  sellerPayouts?: Maybe<SellerPayoutList>;
  sellerPromotion?: Maybe<SellerPromotionCampaign>;
  /**  Plans: get the active plan for a seller/channel  */
  sellerPromotionPlan?: Maybe<PromotionPlan>;
  /**  List campaigns — SuperAdmin sees all, sellers see their own  */
  sellerPromotions: SellerPromotionCampaignList;
  /** Phase 2 — Get resolved collection IDs (roots + descendants) for a seller */
  sellerResolvedCollectionIds: ResolvedTaxonomy;
  sellers: SellerList;
  shippingCalculators: Array<ConfigurableOperationDefinition>;
  shippingEligibilityCheckers: Array<ConfigurableOperationDefinition>;
  shippingMethod?: Maybe<ShippingMethod>;
  shippingMethods: ShippingMethodList;
  /** Generate slug for entity */
  slugForEntity: Scalars['String']['output'];
  stockLocation?: Maybe<StockLocation>;
  stockLocations: StockLocationList;
  syncIncidents: SyncIncidentList;
  tag: Tag;
  tags: TagList;
  taxCategories: TaxCategoryList;
  taxCategory?: Maybe<TaxCategory>;
  taxRate?: Maybe<TaxRate>;
  taxRates: TaxRateList;
  testEligibleShippingMethods: Array<ShippingMethodQuote>;
  testShippingMethod: TestShippingMethodResult;
  validateReviewToken?: Maybe<ReviewRequestResult>;
  variantCashbackPolicy?: Maybe<ProductVariantCashbackPolicy>;
  /** Get all webhooks for the current channel */
  webhooks: Array<Webhook>;
  zone?: Maybe<Zone>;
  zones: ZoneList;
};


export type QueryAdminPromotionLedgerEntriesArgs = {
  accountId: Scalars['ID']['input'];
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryAdministratorArgs = {
  id: Scalars['ID']['input'];
};


export type QueryAdministratorsArgs = {
  options?: InputMaybe<AdministratorListOptions>;
};


export type QueryAllVariantCashbackPoliciesArgs = {
  options?: InputMaybe<VariantCashbackPolicyListOptions>;
};


export type QueryAssetArgs = {
  id: Scalars['ID']['input'];
};


export type QueryAssetsArgs = {
  options?: InputMaybe<AssetListOptions>;
};


export type QueryBbbCapacityGrantsArgs = {
  organizationId: Scalars['ID']['input'];
};


export type QueryBbbMeetingArgs = {
  id: Scalars['ID']['input'];
};


export type QueryBbbMeetingsArgs = {
  options?: InputMaybe<BbbMeetingListOptions>;
  organizationId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryBbbModeratorJoinUrlArgs = {
  meetingId: Scalars['ID']['input'];
  moderatorName: Scalars['String']['input'];
};


export type QueryBbbOrganizationArgs = {
  id: Scalars['ID']['input'];
};


export type QueryBbbOrganizationMemberArgs = {
  id: Scalars['ID']['input'];
};


export type QueryBbbOrganizationMembersArgs = {
  options?: InputMaybe<BbbOrganizationMemberListOptions>;
  organizationId: Scalars['ID']['input'];
};


export type QueryBbbOrganizationsArgs = {
  options?: InputMaybe<BbbOrganizationListOptions>;
};


export type QueryBbbRoomArgs = {
  id: Scalars['ID']['input'];
};


export type QueryBbbRoomsArgs = {
  options?: InputMaybe<BbbRoomListOptions>;
  organizationId: Scalars['ID']['input'];
};


export type QueryBbbScheduledSessionsArgs = {
  organizationId: Scalars['ID']['input'];
};


export type QueryBbbServerArgs = {
  id: Scalars['ID']['input'];
};


export type QueryBbbServersArgs = {
  options?: InputMaybe<BbbServerListOptions>;
};


export type QueryCanReviewProductArgs = {
  productId: Scalars['ID']['input'];
};


export type QueryCashbackTransactionsArgs = {
  options?: InputMaybe<CashbackTransactionListOptions>;
  walletId: Scalars['ID']['input'];
};


export type QueryChannelArgs = {
  id: Scalars['ID']['input'];
};


export type QueryChannelsArgs = {
  options?: InputMaybe<ChannelListOptions>;
};


export type QueryCollectionArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
};


export type QueryCollectionsArgs = {
  options?: InputMaybe<CollectionListOptions>;
};


export type QueryCountriesArgs = {
  options?: InputMaybe<CountryListOptions>;
};


export type QueryCountryArgs = {
  id: Scalars['ID']['input'];
};


export type QueryCustomerArgs = {
  id: Scalars['ID']['input'];
};


export type QueryCustomerCashbackWalletArgs = {
  customerId: Scalars['ID']['input'];
};


export type QueryCustomerGroupArgs = {
  id: Scalars['ID']['input'];
};


export type QueryCustomerGroupsArgs = {
  options?: InputMaybe<CustomerGroupListOptions>;
};


export type QueryCustomersArgs = {
  options?: InputMaybe<CustomerListOptions>;
};


export type QueryDeliveryAssignmentArgs = {
  sellerOrderId: Scalars['ID']['input'];
};


export type QueryDeliveryAssignmentsArgs = {
  driverId?: InputMaybe<Scalars['String']['input']>;
  orderId?: InputMaybe<Scalars['String']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  sortField?: InputMaybe<Scalars['String']['input']>;
  sortOrder?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryDeliveryStatsArgs = {
  dateFrom?: InputMaybe<Scalars['String']['input']>;
  dateTo?: InputMaybe<Scalars['String']['input']>;
};


export type QueryEligibleShippingMethodsForDraftOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type QueryFacetArgs = {
  id: Scalars['ID']['input'];
};


export type QueryFacetValueArgs = {
  id: Scalars['ID']['input'];
};


export type QueryFacetValuesArgs = {
  options?: InputMaybe<FacetValueListOptions>;
};


export type QueryFacetsArgs = {
  options?: InputMaybe<FacetListOptions>;
};


export type QueryFailedDeliveriesArgs = {
  take?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryGetSettingsStoreValueArgs = {
  key: Scalars['String']['input'];
};


export type QueryGetSettingsStoreValuesArgs = {
  keys: Array<Scalars['String']['input']>;
};


export type QueryJobArgs = {
  jobId: Scalars['ID']['input'];
};


export type QueryJobBufferSizeArgs = {
  bufferIds?: InputMaybe<Array<Scalars['String']['input']>>;
};


export type QueryJobsArgs = {
  options?: InputMaybe<JobListOptions>;
};


export type QueryJobsByIdArgs = {
  jobIds: Array<Scalars['ID']['input']>;
};


export type QueryMetricSummaryArgs = {
  input?: InputMaybe<MetricSummaryInput>;
};


export type QueryMyPayoutsArgs = {
  options?: InputMaybe<SellerPayoutListOptions>;
};


export type QueryMyPromotionLedgerEntriesArgs = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryMySellerDashboardArgs = {
  period: DashboardPeriod;
};


export type QueryMyVariantCashbackPoliciesArgs = {
  options?: InputMaybe<VariantCashbackPolicyListOptions>;
};


export type QueryOrderArgs = {
  id: Scalars['ID']['input'];
};


export type QueryOrdersArgs = {
  options?: InputMaybe<OrderListOptions>;
};


export type QueryPaymentMethodArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPaymentMethodsArgs = {
  options?: InputMaybe<PaymentMethodListOptions>;
};


export type QueryPendingDeliveriesArgs = {
  take?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryPendingReviewRequestsArgs = {
  options?: InputMaybe<ProductReviewListOptions>;
};


export type QueryPreviewCollectionVariantsArgs = {
  input: PreviewCollectionVariantsInput;
  options?: InputMaybe<ProductVariantListOptions>;
};


export type QueryPreviewSellerTaxonomySuggestionArgs = {
  category: Scalars['String']['input'];
};


export type QueryProductArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
};


export type QueryProductOptionArgs = {
  id: Scalars['ID']['input'];
};


export type QueryProductOptionGroupArgs = {
  id: Scalars['ID']['input'];
};


export type QueryProductOptionGroupsArgs = {
  filterTerm?: InputMaybe<Scalars['String']['input']>;
};


export type QueryProductOptionsArgs = {
  groupId?: InputMaybe<Scalars['ID']['input']>;
  options?: InputMaybe<ProductOptionListOptions>;
};


export type QueryProductReviewArgs = {
  id: Scalars['ID']['input'];
};


export type QueryProductReviewsArgs = {
  options?: InputMaybe<ProductReviewListOptions>;
};


export type QueryProductVariantArgs = {
  id: Scalars['ID']['input'];
};


export type QueryProductVariantsArgs = {
  options?: InputMaybe<ProductVariantListOptions>;
  productId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryProductsArgs = {
  options?: InputMaybe<ProductListOptions>;
};


export type QueryPromotionArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPromotionAggregateReportArgs = {
  range: PromotionReportRangeInput;
};


export type QueryPromotionCampaignReportArgs = {
  campaignId: Scalars['ID']['input'];
  range: PromotionReportRangeInput;
};


export type QueryPromotionsArgs = {
  options?: InputMaybe<PromotionListOptions>;
};


export type QueryProvinceArgs = {
  id: Scalars['ID']['input'];
};


export type QueryProvincesArgs = {
  options?: InputMaybe<ProvinceListOptions>;
};


export type QueryRoleArgs = {
  id: Scalars['ID']['input'];
};


export type QueryRolesArgs = {
  options?: InputMaybe<RoleListOptions>;
};


export type QuerySearchArgs = {
  input: SearchInput;
};


export type QuerySellerArgs = {
  id: Scalars['ID']['input'];
};


export type QuerySellerCashbackPolicyArgs = {
  sellerId: Scalars['ID']['input'];
};


export type QuerySellerCategoryPolicyArgs = {
  id: Scalars['ID']['input'];
};


export type QuerySellerCollectionTreeArgs = {
  ids?: InputMaybe<Array<Scalars['ID']['input']>>;
};


export type QuerySellerLifecycleStateArgs = {
  sellerId: Scalars['ID']['input'];
};


export type QuerySellerOperationsProfileArgs = {
  sellerId: Scalars['ID']['input'];
};


export type QuerySellerOrderFulfillmentPlanArgs = {
  orderId: Scalars['ID']['input'];
};


export type QuerySellerPayoutsArgs = {
  options?: InputMaybe<SellerPayoutListOptions>;
};


export type QuerySellerPromotionArgs = {
  campaignId: Scalars['ID']['input'];
};


export type QuerySellerPromotionPlanArgs = {
  channelId: Scalars['ID']['input'];
  sellerId: Scalars['ID']['input'];
};


export type QuerySellerPromotionsArgs = {
  options?: InputMaybe<SellerPromotionListOptions>;
};


export type QuerySellerResolvedCollectionIdsArgs = {
  sellerId: Scalars['ID']['input'];
};


export type QuerySellersArgs = {
  options?: InputMaybe<SellerListOptions>;
};


export type QueryShippingMethodArgs = {
  id: Scalars['ID']['input'];
};


export type QueryShippingMethodsArgs = {
  options?: InputMaybe<ShippingMethodListOptions>;
};


export type QuerySlugForEntityArgs = {
  input: SlugForEntityInput;
};


export type QueryStockLocationArgs = {
  id: Scalars['ID']['input'];
};


export type QueryStockLocationsArgs = {
  options?: InputMaybe<StockLocationListOptions>;
};


export type QuerySyncIncidentsArgs = {
  severity?: InputMaybe<Scalars['String']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryTagArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTagsArgs = {
  options?: InputMaybe<TagListOptions>;
};


export type QueryTaxCategoriesArgs = {
  options?: InputMaybe<TaxCategoryListOptions>;
};


export type QueryTaxCategoryArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTaxRateArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTaxRatesArgs = {
  options?: InputMaybe<TaxRateListOptions>;
};


export type QueryTestEligibleShippingMethodsArgs = {
  input: TestEligibleShippingMethodsInput;
};


export type QueryTestShippingMethodArgs = {
  input: TestShippingMethodInput;
};


export type QueryValidateReviewTokenArgs = {
  token: Scalars['String']['input'];
};


export type QueryVariantCashbackPolicyArgs = {
  productVariantId: Scalars['ID']['input'];
};


export type QueryZoneArgs = {
  id: Scalars['ID']['input'];
};


export type QueryZonesArgs = {
  options?: InputMaybe<ZoneListOptions>;
};

export type Refund = Node & {
  adjustment: Scalars['Money']['output'];
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  items: Scalars['Money']['output'];
  lines: Array<RefundLine>;
  metadata?: Maybe<Scalars['JSON']['output']>;
  method?: Maybe<Scalars['String']['output']>;
  paymentId: Scalars['ID']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  shipping: Scalars['Money']['output'];
  state: Scalars['String']['output'];
  total: Scalars['Money']['output'];
  transactionId?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

/** Returned if `amount` is greater than the maximum un-refunded amount of the Payment */
export type RefundAmountError = ErrorResult & {
  errorCode: ErrorCode;
  maximumRefundable: Scalars['Int']['output'];
  message: Scalars['String']['output'];
};

export type RefundLine = {
  orderLine: OrderLine;
  orderLineId: Scalars['ID']['output'];
  quantity: Scalars['Int']['output'];
  refund: Refund;
  refundId: Scalars['ID']['output'];
};

export type RefundOrderInput = {
  /** @deprecated Use the `amount` field instead */
  adjustment?: InputMaybe<Scalars['Money']['input']>;
  /**
   * The amount to be refunded to this particular payment. This was introduced in v2.2.0 as the preferred way to specify the refund amount.
   * Can be as much as the total amount of the payment minus the sum of all previous refunds.
   */
  amount?: InputMaybe<Scalars['Money']['input']>;
  /** @deprecated Use the `amount` field instead */
  lines?: InputMaybe<Array<OrderLineInput>>;
  paymentId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
  /** @deprecated Use the `amount` field instead */
  shipping?: InputMaybe<Scalars['Money']['input']>;
};

export type RefundOrderResult = AlreadyRefundedError | MultipleOrderError | NothingToRefundError | OrderStateTransitionError | PaymentOrderMismatchError | QuantityTooGreatError | Refund | RefundAmountError | RefundOrderStateError | RefundStateTransitionError;

/** Returned if an attempting to refund an Order which is not in the expected state */
export type RefundOrderStateError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
  orderState: Scalars['String']['output'];
};

/**
 * Returned when a call to modifyOrder fails to include a refundPaymentId even
 * though the price has decreased as a result of the changes.
 */
export type RefundPaymentIdMissingError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
};

/** Returned when there is an error in transitioning the Refund state */
export type RefundStateTransitionError = ErrorResult & {
  errorCode: ErrorCode;
  fromState: Scalars['String']['output'];
  message: Scalars['String']['output'];
  toState: Scalars['String']['output'];
  transitionError: Scalars['String']['output'];
};

export type Region = {
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  parent?: Maybe<Region>;
  parentId?: Maybe<Scalars['ID']['output']>;
  translations: Array<RegionTranslation>;
  type: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type RegionTranslation = {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type RegisterSellerInput = {
  seller: CreateSellerInput;
  shopName: Scalars['String']['input'];
};

export type RelationCustomFieldConfig = CustomField & {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  entity: Scalars['String']['output'];
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  scalarFields: Array<Scalars['String']['output']>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type Release = Node & StockMovement & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  productVariant: ProductVariant;
  quantity: Scalars['Int']['output'];
  type: StockMovementType;
  updatedAt: Scalars['DateTime']['output'];
};

export type RemoveCollectionsFromChannelInput = {
  channelId: Scalars['ID']['input'];
  collectionIds: Array<Scalars['ID']['input']>;
};

export type RemoveFacetFromChannelResult = Facet | FacetInUseError;

export type RemoveFacetsFromChannelInput = {
  channelId: Scalars['ID']['input'];
  facetIds: Array<Scalars['ID']['input']>;
  force?: InputMaybe<Scalars['Boolean']['input']>;
};

export type RemoveOptionGroupFromProductResult = Product | ProductOptionInUseError;

export type RemoveOrderItemsResult = Order | OrderInterceptorError | OrderModificationError;

export type RemovePaymentMethodsFromChannelInput = {
  channelId: Scalars['ID']['input'];
  paymentMethodIds: Array<Scalars['ID']['input']>;
};

export type RemoveProductVariantsFromChannelInput = {
  channelId: Scalars['ID']['input'];
  productVariantIds: Array<Scalars['ID']['input']>;
};

export type RemoveProductsFromChannelInput = {
  channelId: Scalars['ID']['input'];
  productIds: Array<Scalars['ID']['input']>;
};

export type RemovePromotionsFromChannelInput = {
  channelId: Scalars['ID']['input'];
  promotionIds: Array<Scalars['ID']['input']>;
};

export type RemoveShippingMethodsFromChannelInput = {
  channelId: Scalars['ID']['input'];
  shippingMethodIds: Array<Scalars['ID']['input']>;
};

export type RemoveStockLocationsFromChannelInput = {
  channelId: Scalars['ID']['input'];
  stockLocationIds: Array<Scalars['ID']['input']>;
};

export type ReportReviewInput = {
  comment?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  reason: ReviewReportReason;
};

/** Phase 2 — Result of resolving a collection tree for a seller */
export type ResolvedTaxonomy = {
  allCollectionIds: Array<Scalars['ID']['output']>;
  descendantCount: Scalars['Int']['output'];
  rootCollections: Array<SuggestedCollection>;
};

export type RetryDispatchResult = {
  message: Scalars['String']['output'];
  success: Scalars['Boolean']['output'];
};

export type Return = Node & StockMovement & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  productVariant: ProductVariant;
  quantity: Scalars['Int']['output'];
  type: StockMovementType;
  updatedAt: Scalars['DateTime']['output'];
};

export type ReviewEligibilityResult = {
  eligible: Scalars['Boolean']['output'];
  eligibleOrderId?: Maybe<Scalars['ID']['output']>;
  eligibleOrderLineId?: Maybe<Scalars['ID']['output']>;
  hasExistingReview: Scalars['Boolean']['output'];
  hasPurchased: Scalars['Boolean']['output'];
  reason: Scalars['String']['output'];
};

export type ReviewReportReason =
  | 'FAKE'
  | 'IRRELEVANT'
  | 'OFFENSIVE'
  | 'OTHER'
  | 'SPAM';

export type ReviewRequestList = {
  items: Array<ReviewRequestResult>;
  totalItems: Scalars['Int']['output'];
};

export type ReviewRequestResult = {
  clickCount: Scalars['Int']['output'];
  expiresAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  openedAt?: Maybe<Scalars['DateTime']['output']>;
  order: Order;
  product: Product;
  reminderCount: Scalars['Int']['output'];
  reviewToken: Scalars['String']['output'];
  reviewedAt?: Maybe<Scalars['DateTime']['output']>;
  scheduledAt: Scalars['DateTime']['output'];
  sentAt?: Maybe<Scalars['DateTime']['output']>;
  status: Scalars['String']['output'];
};

export type Role = Node & {
  channels: Array<Channel>;
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  permissions: Array<Permission>;
  updatedAt: Scalars['DateTime']['output'];
};

export type RoleFilterParameter = {
  _and?: InputMaybe<Array<RoleFilterParameter>>;
  _or?: InputMaybe<Array<RoleFilterParameter>>;
  code?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  description?: InputMaybe<StringOperators>;
  id?: InputMaybe<IdOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type RoleList = PaginatedList & {
  items: Array<Role>;
  totalItems: Scalars['Int']['output'];
};

export type RoleListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<RoleFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<RoleSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type RoleSortParameter = {
  code?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  description?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type Sale = Node & StockMovement & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  productVariant: ProductVariant;
  quantity: Scalars['Int']['output'];
  type: StockMovementType;
  updatedAt: Scalars['DateTime']['output'];
};

export type ScheduledTask = {
  description: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  isRunning: Scalars['Boolean']['output'];
  lastExecutedAt?: Maybe<Scalars['DateTime']['output']>;
  lastResult?: Maybe<Scalars['JSON']['output']>;
  nextExecutionAt?: Maybe<Scalars['DateTime']['output']>;
  schedule: Scalars['String']['output'];
  scheduleDescription: Scalars['String']['output'];
};

export type SearchInput = {
  collectionId?: InputMaybe<Scalars['ID']['input']>;
  collectionSlug?: InputMaybe<Scalars['String']['input']>;
  facetValueFilters?: InputMaybe<Array<FacetValueFilterInput>>;
  /** @deprecated Use `facetValueFilters` instead */
  facetValueIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  /** @deprecated Use `facetValueFilters` instead */
  facetValueOperator?: InputMaybe<LogicalOperator>;
  groupByProduct?: InputMaybe<Scalars['Boolean']['input']>;
  groupBySKU?: InputMaybe<Scalars['Boolean']['input']>;
  inStock?: InputMaybe<Scalars['Boolean']['input']>;
  priceRange?: InputMaybe<PriceRangeInput>;
  priceRangeWithTax?: InputMaybe<PriceRangeInput>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  sort?: InputMaybe<SearchResultSortParameter>;
  take?: InputMaybe<Scalars['Int']['input']>;
  term?: InputMaybe<Scalars['String']['input']>;
};

export type SearchReindexResponse = {
  success: Scalars['Boolean']['output'];
};

export type SearchResponse = {
  collections: Array<CollectionResult>;
  facetValues: Array<FacetValueResult>;
  items: Array<SearchResult>;
  prices: SearchResponsePriceData;
  totalItems: Scalars['Int']['output'];
};

export type SearchResponsePriceData = {
  buckets: Array<PriceRangeBucket>;
  bucketsWithTax: Array<PriceRangeBucket>;
  range: PriceRange;
  rangeWithTax: PriceRange;
};

export type SearchResult = {
  /** An array of ids of the Channels in which this result appears */
  channelIds: Array<Scalars['ID']['output']>;
  /** An array of ids of the Collections in which this result appears */
  collectionIds: Array<Scalars['ID']['output']>;
  currencyCode: CurrencyCode;
  /** @deprecated Use customProductMappings or customProductVariantMappings */
  customMappings: CustomProductVariantMappings;
  customProductVariantMappings: CustomProductVariantMappings;
  customScriptFields: CustomScriptFields;
  description: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  facetIds: Array<Scalars['ID']['output']>;
  facetValueIds: Array<Scalars['ID']['output']>;
  inStock?: Maybe<Scalars['Boolean']['output']>;
  price: SearchResultPrice;
  priceWithTax: SearchResultPrice;
  productAsset?: Maybe<SearchResultAsset>;
  productId: Scalars['ID']['output'];
  productName: Scalars['String']['output'];
  productVariantAsset?: Maybe<SearchResultAsset>;
  productVariantId: Scalars['ID']['output'];
  productVariantName: Scalars['String']['output'];
  /** A relevance score for the result. Differs between database implementations */
  score: Scalars['Float']['output'];
  sku: Scalars['String']['output'];
  slug: Scalars['String']['output'];
};

export type SearchResultAsset = {
  focalPoint?: Maybe<Coordinate>;
  id: Scalars['ID']['output'];
  preview: Scalars['String']['output'];
};

/** The price of a search result product, either as a range or as a single price */
export type SearchResultPrice = PriceRange | SinglePrice;

export type SearchResultSortParameter = {
  name?: InputMaybe<SortOrder>;
  price?: InputMaybe<SortOrder>;
};

export type Seller = Node & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<SellerCustomFields>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type SellerCashbackPolicy = {
  createdAt: Scalars['DateTime']['output'];
  expiryDays: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  maxEarnPerOrderPaise?: Maybe<Scalars['Int']['output']>;
  maxRedemptionPct: Scalars['Int']['output'];
  minOrderAmountPaise: Scalars['Int']['output'];
  pendingDays: Scalars['Int']['output'];
  rateType: Scalars['String']['output'];
  rateValue: Scalars['Int']['output'];
  sellerId: Scalars['ID']['output'];
  state: CashbackPolicyState;
  updatedAt: Scalars['DateTime']['output'];
};

export type SellerCashbackRedemptionConfig = {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  maxRedemptionAmountPaise?: Maybe<Scalars['Int']['output']>;
  maxRedemptionPct: Scalars['Int']['output'];
  sellerId: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type SellerCategoryPolicy = {
  allowedCollections: Array<SellerCategoryPolicyCollectionRef>;
  allowedFacets: Array<SellerCategoryPolicyFacetRef>;
  blockedFacetValues: Array<SellerCategoryPolicyFacetValueRef>;
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  moderationRules?: Maybe<Scalars['JSON']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type SellerCategoryPolicyCollectionRef = {
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
};

export type SellerCategoryPolicyFacetRef = {
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type SellerCategoryPolicyFacetValueRef = {
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type SellerCustomFields = {
  deliveryRadiusKm?: Maybe<Scalars['Float']['output']>;
  isVerified?: Maybe<Scalars['Boolean']['output']>;
  onboardingStatus?: Maybe<Scalars['String']['output']>;
  operationalStatus?: Maybe<Scalars['String']['output']>;
  razorpayLinkedAccountId?: Maybe<Scalars['String']['output']>;
};

export type SellerDashboardSummary = {
  /** Payout summary. */
  pendingPayoutPaise: Scalars['Int']['output'];
  /** Revenue breakdown for the requested period. */
  period: SellerRevenueBreakdown;
  /** Revenue breakdown for the previous equivalent period (for % change). */
  previousPeriod: SellerRevenueBreakdown;
  settledPayoutPaise: Scalars['Int']['output'];
  /** Top 5 products by revenue. */
  topProducts: Array<SellerTopProduct>;
  /** Available cashback balance for the seller's customers (aggregate). */
  totalOutstandingCashbackPaise: Scalars['Int']['output'];
};

export type SellerFilterParameter = {
  _and?: InputMaybe<Array<SellerFilterParameter>>;
  _or?: InputMaybe<Array<SellerFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  deliveryRadiusKm?: InputMaybe<NumberOperators>;
  id?: InputMaybe<IdOperators>;
  isVerified?: InputMaybe<BooleanOperators>;
  name?: InputMaybe<StringOperators>;
  onboardingStatus?: InputMaybe<StringOperators>;
  operationalStatus?: InputMaybe<StringOperators>;
  razorpayLinkedAccountId?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

/**
 * Complete lifecycle state snapshot for a seller.
 * Returned by both the sellerLifecycleState query and all transition mutations,
 * so callers never need a separate refetch after a transition.
 */
export type SellerLifecycleState = {
  id: Scalars['ID']['output'];
  isVerified: Scalars['Boolean']['output'];
  onboardingStatus: SellerOnboardingStatus;
  operationalStatus: SellerOperationalStatus;
  verificationState: SellerVerificationStatus;
};

export type SellerList = PaginatedList & {
  items: Array<Seller>;
  totalItems: Scalars['Int']['output'];
};

export type SellerListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<SellerFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<SellerSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

/** Onboarding FSM states. */
export type SellerOnboardingStatus =
  | 'APPROVED'
  | 'PENDING'
  | 'REJECTED';

/** Onboarding transitions. */
export type SellerOnboardingTransition =
  | 'APPROVE'
  | 'REJECT'
  | 'RESET';

/** Operational FSM states. */
export type SellerOperationalStatus =
  | 'ACTIVE'
  | 'PAUSED';

/** Operational transitions. */
export type SellerOperationalTransition =
  | 'PAUSE'
  | 'RESUME';

export type SellerOperationsProfile = {
  acceptsOrders: Scalars['Boolean']['output'];
  businessHoursJson?: Maybe<Scalars['JSON']['output']>;
  createdAt: Scalars['DateTime']['output'];
  deliveryModel: Scalars['String']['output'];
  fulfillmentMode: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  minOrderAmount: Scalars['Int']['output'];
  operationalState: Scalars['String']['output'];
  /** Phase 3 — reference to a SellerCategoryPolicy (by code) */
  policyCode?: Maybe<Scalars['String']['output']>;
  prepTimeMin: Scalars['Int']['output'];
  /** Phase 1 backward-compat — display label only */
  primaryCategory?: Maybe<Scalars['String']['output']>;
  sellerId: Scalars['ID']['output'];
  serviceAreaType: Scalars['String']['output'];
  serviceLocalities?: Maybe<Array<Scalars['String']['output']>>;
  supportsScheduledOrders: Scalars['Boolean']['output'];
  supportsSubstitutions: Scalars['Boolean']['output'];
  /** Phase 2 — root collection IDs for tree-based taxonomy permissions */
  taxonomyRootCollectionIds?: Maybe<Array<Scalars['ID']['output']>>;
  updatedAt: Scalars['DateTime']['output'];
};

export type SellerOrderFulfillmentPlan = {
  createdAt: Scalars['DateTime']['output'];
  deliveryFee: Scalars['Int']['output'];
  dispatchReadiness: Scalars['String']['output'];
  distanceKm?: Maybe<Scalars['Float']['output']>;
  estimatedDeliveryMinutes?: Maybe<Scalars['Int']['output']>;
  estimatedPrepMinutes?: Maybe<Scalars['Int']['output']>;
  fulfillmentMode: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  notes: Array<Scalars['String']['output']>;
  orderId: Scalars['ID']['output'];
  sellerId: Scalars['ID']['output'];
  stockLocationId?: Maybe<Scalars['ID']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type SellerPayout = {
  amount: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  currencyCode: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  seller?: Maybe<Seller>;
  sellerId: Scalars['String']['output'];
  status: PayoutStatus;
  transactionRef?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type SellerPayoutFilterInput = {
  createdAt?: InputMaybe<DateOperators>;
  currencyCode?: InputMaybe<StringOperators>;
  sellerId?: InputMaybe<StringOperators>;
  status?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type SellerPayoutList = {
  items: Array<SellerPayout>;
  totalItems: Scalars['Int']['output'];
};

export type SellerPayoutListOptions = {
  filter?: InputMaybe<SellerPayoutFilterInput>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  sort?: InputMaybe<SellerPayoutSortInput>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type SellerPayoutSortInput = {
  amount?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  currencyCode?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  sellerId?: InputMaybe<SortOrder>;
  status?: InputMaybe<SortOrder>;
  transactionRef?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type SellerPromotionCampaign = {
  allowedTransitions: Array<SellerPromotionStatus>;
  bannerCtaLabel?: Maybe<Scalars['String']['output']>;
  bannerCtaUrl?: Maybe<Scalars['String']['output']>;
  bannerImage?: Maybe<Asset>;
  bannerImageAssetId?: Maybe<Scalars['ID']['output']>;
  bannerSubtitle?: Maybe<Scalars['String']['output']>;
  bannerTitle?: Maybe<Scalars['String']['output']>;
  boostScore: Scalars['Int']['output'];
  budgetConsumed: Scalars['Int']['output'];
  budgetTotal: Scalars['Int']['output'];
  channelId: Scalars['ID']['output'];
  collectionIds: Array<Scalars['ID']['output']>;
  createdAt: Scalars['DateTime']['output'];
  endAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  sellerId: Scalars['ID']['output'];
  startAt: Scalars['DateTime']['output'];
  status: SellerPromotionStatus;
  updatedAt: Scalars['DateTime']['output'];
};

export type SellerPromotionCampaignList = {
  items: Array<SellerPromotionCampaign>;
  totalItems: Scalars['Int']['output'];
};

export type SellerPromotionListOptions = {
  filterTerm?: InputMaybe<Scalars['String']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<SellerPromotionStatus>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type SellerPromotionStatus =
  | 'ACTIVE'
  | 'CANCELLED'
  | 'DRAFT'
  | 'EXPIRED'
  | 'PAUSED'
  | 'PENDING_PAYMENT';

export type SellerRevenueBreakdown = {
  /** Average order value in paise. */
  averageOrderValuePaise: Scalars['Int']['output'];
  /** Gross order value (sum of line prices with tax). */
  grossRevenuePaise: Scalars['Int']['output'];
  /** Net amount after fee. */
  netRevenuePaise: Scalars['Int']['output'];
  /** Number of orders in the period. */
  orderCount: Scalars['Int']['output'];
  /** Platform fee deducted. */
  platformFeePaise: Scalars['Int']['output'];
};

export type SellerSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  deliveryRadiusKm?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  isVerified?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  onboardingStatus?: InputMaybe<SortOrder>;
  operationalStatus?: InputMaybe<SortOrder>;
  razorpayLinkedAccountId?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type SellerTopProduct = {
  productId: Scalars['ID']['output'];
  productName: Scalars['String']['output'];
  revenuePaise: Scalars['Int']['output'];
  unitsSold: Scalars['Int']['output'];
};

/** Verification FSM states. */
export type SellerVerificationStatus =
  | 'UNVERIFIED'
  | 'VERIFIED';

/** Verification transitions. */
export type SellerVerificationTransition =
  | 'UNVERIFY'
  | 'VERIFY';

export type ServerConfig = {
  /**
   * This field is deprecated in v2.2 in favor of the entityCustomFields field,
   * which allows custom fields to be defined on user-supplies entities.
   */
  customFieldConfig: CustomFields;
  entityCustomFields: Array<EntityCustomFields>;
  moneyStrategyPrecision: Scalars['Int']['output'];
  orderProcess: Array<OrderProcessState>;
  permissions: Array<PermissionDefinition>;
  permittedAssetTypes: Array<Scalars['String']['output']>;
};

export type SetCustomerForDraftOrderResult = EmailAddressConflictError | Order;

export type SetOrderCustomerInput = {
  customerId: Scalars['ID']['input'];
  note?: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['ID']['input'];
};

export type SetOrderShippingMethodResult = IneligibleShippingMethodError | NoActiveOrderError | Order | OrderModificationError;

export type SetSettingsStoreValueResult = {
  error?: Maybe<Scalars['String']['output']>;
  key: Scalars['String']['output'];
  result: Scalars['Boolean']['output'];
};

export type SettingsStoreInput = {
  key: Scalars['String']['input'];
  value: Scalars['JSON']['input'];
};

/** Returned if the Payment settlement fails */
export type SettlePaymentError = ErrorResult & {
  errorCode: ErrorCode;
  message: Scalars['String']['output'];
  paymentErrorMessage: Scalars['String']['output'];
};

export type SettlePaymentResult = OrderStateTransitionError | Payment | PaymentStateTransitionError | SettlePaymentError;

export type SettleRefundInput = {
  id: Scalars['ID']['input'];
  transactionId: Scalars['String']['input'];
};

export type SettleRefundResult = Refund | RefundStateTransitionError;

export type ShippingDefaultsInput = {
  flatRatePaise?: InputMaybe<Scalars['Int']['input']>;
  pricesIncludeTax?: InputMaybe<Scalars['Boolean']['input']>;
  taxRatePercent?: InputMaybe<Scalars['Int']['input']>;
};

export type ShippingLine = {
  customFields?: Maybe<Scalars['JSON']['output']>;
  discountedPrice: Scalars['Money']['output'];
  discountedPriceWithTax: Scalars['Money']['output'];
  discounts: Array<Discount>;
  id: Scalars['ID']['output'];
  price: Scalars['Money']['output'];
  priceWithTax: Scalars['Money']['output'];
  shippingMethod: ShippingMethod;
};

export type ShippingMethod = Node & {
  calculator: ConfigurableOperation;
  checker: ConfigurableOperation;
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  description: Scalars['String']['output'];
  fulfillmentHandlerCode: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  translations: Array<ShippingMethodTranslation>;
  updatedAt: Scalars['DateTime']['output'];
};

export type ShippingMethodFilterParameter = {
  _and?: InputMaybe<Array<ShippingMethodFilterParameter>>;
  _or?: InputMaybe<Array<ShippingMethodFilterParameter>>;
  code?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  description?: InputMaybe<StringOperators>;
  fulfillmentHandlerCode?: InputMaybe<StringOperators>;
  id?: InputMaybe<IdOperators>;
  languageCode?: InputMaybe<StringOperators>;
  name?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type ShippingMethodList = PaginatedList & {
  items: Array<ShippingMethod>;
  totalItems: Scalars['Int']['output'];
};

export type ShippingMethodListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<ShippingMethodFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<ShippingMethodSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type ShippingMethodQuote = {
  code: Scalars['String']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  /** Any optional metadata returned by the ShippingCalculator in the ShippingCalculationResult */
  metadata?: Maybe<Scalars['JSON']['output']>;
  name: Scalars['String']['output'];
  price: Scalars['Money']['output'];
  priceWithTax: Scalars['Money']['output'];
};

export type ShippingMethodSortParameter = {
  code?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  description?: InputMaybe<SortOrder>;
  fulfillmentHandlerCode?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type ShippingMethodTranslation = {
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  languageCode: LanguageCode;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ShippingMethodTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
};

/** The price value where the result has a single price */
export type SinglePrice = {
  value: Scalars['Money']['output'];
};

export type SlugForEntityInput = {
  entityId?: InputMaybe<Scalars['ID']['input']>;
  entityName: Scalars['String']['input'];
  fieldName: Scalars['String']['input'];
  inputValue: Scalars['String']['input'];
};

export type SortOrder =
  | 'ASC'
  | 'DESC';

export type StockAdjustment = Node & StockMovement & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  productVariant: ProductVariant;
  quantity: Scalars['Int']['output'];
  type: StockMovementType;
  updatedAt: Scalars['DateTime']['output'];
};

export type StockLevel = Node & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  stockAllocated: Scalars['Int']['output'];
  stockLocation: StockLocation;
  stockLocationId: Scalars['ID']['output'];
  stockOnHand: Scalars['Int']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type StockLevelInput = {
  stockLocationId: Scalars['ID']['input'];
  stockOnHand: Scalars['Int']['input'];
};

export type StockLocation = Node & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<StockLocationCustomFields>;
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type StockLocationCustomFields = {
  city?: Maybe<Scalars['String']['output']>;
  latitude?: Maybe<Scalars['Float']['output']>;
  longitude?: Maybe<Scalars['Float']['output']>;
  postalCode?: Maybe<Scalars['String']['output']>;
};

export type StockLocationFilterParameter = {
  _and?: InputMaybe<Array<StockLocationFilterParameter>>;
  _or?: InputMaybe<Array<StockLocationFilterParameter>>;
  city?: InputMaybe<StringOperators>;
  createdAt?: InputMaybe<DateOperators>;
  description?: InputMaybe<StringOperators>;
  id?: InputMaybe<IdOperators>;
  latitude?: InputMaybe<NumberOperators>;
  longitude?: InputMaybe<NumberOperators>;
  name?: InputMaybe<StringOperators>;
  postalCode?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type StockLocationList = PaginatedList & {
  items: Array<StockLocation>;
  totalItems: Scalars['Int']['output'];
};

export type StockLocationListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<StockLocationFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<StockLocationSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type StockLocationSortParameter = {
  city?: InputMaybe<SortOrder>;
  createdAt?: InputMaybe<SortOrder>;
  description?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  latitude?: InputMaybe<SortOrder>;
  longitude?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  postalCode?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type StockMovement = {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  productVariant: ProductVariant;
  quantity: Scalars['Int']['output'];
  type: StockMovementType;
  updatedAt: Scalars['DateTime']['output'];
};

export type StockMovementItem = Allocation | Cancellation | Release | Return | Sale | StockAdjustment;

export type StockMovementList = {
  items: Array<StockMovementItem>;
  totalItems: Scalars['Int']['output'];
};

export type StockMovementListOptions = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
  type?: InputMaybe<StockMovementType>;
};

export type StockMovementType =
  | 'ADJUSTMENT'
  | 'ALLOCATION'
  | 'CANCELLATION'
  | 'RELEASE'
  | 'RETURN'
  | 'SALE';

export type StringCustomFieldConfig = CustomField & {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  length?: Maybe<Scalars['Int']['output']>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  options?: Maybe<Array<StringFieldOption>>;
  pattern?: Maybe<Scalars['String']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type StringFieldOption = {
  label?: Maybe<Array<LocalizedString>>;
  value: Scalars['String']['output'];
};

/** Operators for filtering on a list of String fields */
export type StringListOperators = {
  inList: Scalars['String']['input'];
};

/** Operators for filtering on a String field */
export type StringOperators = {
  contains?: InputMaybe<Scalars['String']['input']>;
  eq?: InputMaybe<Scalars['String']['input']>;
  in?: InputMaybe<Array<Scalars['String']['input']>>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  notContains?: InputMaybe<Scalars['String']['input']>;
  notEq?: InputMaybe<Scalars['String']['input']>;
  notIn?: InputMaybe<Array<Scalars['String']['input']>>;
  regex?: InputMaybe<Scalars['String']['input']>;
};

export type StringStructFieldConfig = StructField & {
  description?: Maybe<Array<LocalizedString>>;
  label?: Maybe<Array<LocalizedString>>;
  length?: Maybe<Scalars['Int']['output']>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  options?: Maybe<Array<StringFieldOption>>;
  pattern?: Maybe<Scalars['String']['output']>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type StructCustomFieldConfig = CustomField & {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  fields: Array<StructFieldConfig>;
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type StructField = {
  description?: Maybe<Array<LocalizedString>>;
  label?: Maybe<Array<LocalizedString>>;
  list?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type StructFieldConfig = BooleanStructFieldConfig | DateTimeStructFieldConfig | FloatStructFieldConfig | IntStructFieldConfig | StringStructFieldConfig | TextStructFieldConfig;

export type SubmitProductReviewInput = {
  assetIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  authorLocation?: InputMaybe<Scalars['String']['input']>;
  authorName?: InputMaybe<Scalars['String']['input']>;
  body: Scalars['String']['input'];
  orderId?: InputMaybe<Scalars['ID']['input']>;
  orderLineId?: InputMaybe<Scalars['ID']['input']>;
  productId: Scalars['ID']['input'];
  rating: Scalars['Float']['input'];
  reviewToken?: InputMaybe<Scalars['String']['input']>;
  summary: Scalars['String']['input'];
  variantId?: InputMaybe<Scalars['ID']['input']>;
};

/** Indicates that an operation succeeded, where we do not want to return any more specific information. */
export type Success = {
  success: Scalars['Boolean']['output'];
};

export type SuggestedCollection = {
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
};

export type SuggestedFacetValue = {
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type Surcharge = Node & {
  createdAt: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  price: Scalars['Money']['output'];
  priceWithTax: Scalars['Money']['output'];
  sku?: Maybe<Scalars['String']['output']>;
  taxLines: Array<TaxLine>;
  taxRate: Scalars['Float']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type SurchargeInput = {
  description: Scalars['String']['input'];
  price: Scalars['Money']['input'];
  priceIncludesTax: Scalars['Boolean']['input'];
  sku?: InputMaybe<Scalars['String']['input']>;
  taxDescription?: InputMaybe<Scalars['String']['input']>;
  taxRate?: InputMaybe<Scalars['Float']['input']>;
};

export type SyncIncidentList = PaginatedList & {
  items: Array<SyncIncidentRecord>;
  totalItems: Scalars['Int']['output'];
};

export type SyncIncidentRecord = Node & {
  createdAt: Scalars['DateTime']['output'];
  deliveryAssignmentId?: Maybe<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  incidentType: Scalars['String']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  resolvedAt?: Maybe<Scalars['DateTime']['output']>;
  sellerOrderId?: Maybe<Scalars['String']['output']>;
  severity: Scalars['String']['output'];
  status: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type Tag = Node & {
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
  value: Scalars['String']['output'];
};

export type TagFilterParameter = {
  _and?: InputMaybe<Array<TagFilterParameter>>;
  _or?: InputMaybe<Array<TagFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  id?: InputMaybe<IdOperators>;
  updatedAt?: InputMaybe<DateOperators>;
  value?: InputMaybe<StringOperators>;
};

export type TagList = PaginatedList & {
  items: Array<Tag>;
  totalItems: Scalars['Int']['output'];
};

export type TagListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<TagFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<TagSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type TagSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
  value?: InputMaybe<SortOrder>;
};

export type TaxCategory = Node & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  isDefault: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type TaxCategoryFilterParameter = {
  _and?: InputMaybe<Array<TaxCategoryFilterParameter>>;
  _or?: InputMaybe<Array<TaxCategoryFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  id?: InputMaybe<IdOperators>;
  isDefault?: InputMaybe<BooleanOperators>;
  name?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type TaxCategoryList = PaginatedList & {
  items: Array<TaxCategory>;
  totalItems: Scalars['Int']['output'];
};

export type TaxCategoryListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<TaxCategoryFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<TaxCategorySortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type TaxCategorySortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};

export type TaxLine = {
  description: Scalars['String']['output'];
  taxRate: Scalars['Float']['output'];
};

export type TaxRate = Node & {
  category: TaxCategory;
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  customerGroup?: Maybe<CustomerGroup>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  value: Scalars['Float']['output'];
  zone: Zone;
};

export type TaxRateFilterParameter = {
  _and?: InputMaybe<Array<TaxRateFilterParameter>>;
  _or?: InputMaybe<Array<TaxRateFilterParameter>>;
  categoryId?: InputMaybe<IdOperators>;
  createdAt?: InputMaybe<DateOperators>;
  enabled?: InputMaybe<BooleanOperators>;
  id?: InputMaybe<IdOperators>;
  name?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
  value?: InputMaybe<NumberOperators>;
  zoneId?: InputMaybe<IdOperators>;
};

export type TaxRateList = PaginatedList & {
  items: Array<TaxRate>;
  totalItems: Scalars['Int']['output'];
};

export type TaxRateListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<TaxRateFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<TaxRateSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type TaxRateSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
  value?: InputMaybe<SortOrder>;
};

export type TaxonomySuggestion = {
  collections: Array<SuggestedCollection>;
  facetValues: Array<SuggestedFacetValue>;
};

export type TestEligibleShippingMethodsInput = {
  lines: Array<TestShippingMethodOrderLineInput>;
  shippingAddress: CreateAddressInput;
};

export type TestShippingMethodInput = {
  calculator: ConfigurableOperationInput;
  checker: ConfigurableOperationInput;
  lines: Array<TestShippingMethodOrderLineInput>;
  shippingAddress: CreateAddressInput;
};

export type TestShippingMethodOrderLineInput = {
  productVariantId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
};

export type TestShippingMethodQuote = {
  metadata?: Maybe<Scalars['JSON']['output']>;
  price: Scalars['Money']['output'];
  priceWithTax: Scalars['Money']['output'];
};

export type TestShippingMethodResult = {
  eligible: Scalars['Boolean']['output'];
  quote?: Maybe<TestShippingMethodQuote>;
};

export type TextCustomFieldConfig = CustomField & {
  deprecated?: Maybe<Scalars['Boolean']['output']>;
  deprecationReason?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Array<LocalizedString>>;
  internal?: Maybe<Scalars['Boolean']['output']>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  nullable?: Maybe<Scalars['Boolean']['output']>;
  readonly?: Maybe<Scalars['Boolean']['output']>;
  requiresPermission?: Maybe<Array<Permission>>;
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type TextStructFieldConfig = StructField & {
  description?: Maybe<Array<LocalizedString>>;
  label?: Maybe<Array<LocalizedString>>;
  list: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  type: Scalars['String']['output'];
  ui?: Maybe<Scalars['JSON']['output']>;
};

export type TransitionFulfillmentToStateResult = Fulfillment | FulfillmentStateTransitionError;

export type TransitionOrderToStateResult = Order | OrderStateTransitionError;

export type TransitionPaymentToStateResult = Payment | PaymentStateTransitionError;

export type UpdateActiveAdministratorInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  emailAddress?: InputMaybe<Scalars['String']['input']>;
  firstName?: InputMaybe<Scalars['String']['input']>;
  lastName?: InputMaybe<Scalars['String']['input']>;
  password?: InputMaybe<Scalars['String']['input']>;
};

/**
 * Input used to update an Address.
 *
 * The countryCode must correspond to a `code` property of a Country that has been defined in the
 * Vendure server. The `code` property is typically a 2-character ISO code such as "GB", "US", "DE" etc.
 * If an invalid code is passed, the mutation will fail.
 */
export type UpdateAddressInput = {
  city?: InputMaybe<Scalars['String']['input']>;
  company?: InputMaybe<Scalars['String']['input']>;
  countryCode?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  defaultBillingAddress?: InputMaybe<Scalars['Boolean']['input']>;
  defaultShippingAddress?: InputMaybe<Scalars['Boolean']['input']>;
  fullName?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  phoneNumber?: InputMaybe<Scalars['String']['input']>;
  postalCode?: InputMaybe<Scalars['String']['input']>;
  province?: InputMaybe<Scalars['String']['input']>;
  streetLine1?: InputMaybe<Scalars['String']['input']>;
  streetLine2?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateAdministratorInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  emailAddress?: InputMaybe<Scalars['String']['input']>;
  firstName?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  lastName?: InputMaybe<Scalars['String']['input']>;
  password?: InputMaybe<Scalars['String']['input']>;
  roleIds?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type UpdateAssetInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  focalPoint?: InputMaybe<CoordinateInput>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type UpdateBbbMeetingInput = {
  recordingEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateBbbMemberInput = {
  active?: InputMaybe<Scalars['Boolean']['input']>;
  role?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateBbbOrganizationInput = {
  concurrentMeetingLimit?: InputMaybe<Scalars['Int']['input']>;
  maxParticipantsPerMeeting?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  recordingEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  suspended?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdateBbbRoomInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  maxParticipants?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  recordingEnabled?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdateBbbServerInput = {
  apiSecret?: InputMaybe<Scalars['String']['input']>;
  apiUrl?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  maxLoad?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateChannelInput = {
  availableCurrencyCodes?: InputMaybe<Array<CurrencyCode>>;
  availableLanguageCodes?: InputMaybe<Array<LanguageCode>>;
  code?: InputMaybe<Scalars['String']['input']>;
  /** @deprecated Use defaultCurrencyCode instead */
  currencyCode?: InputMaybe<CurrencyCode>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  defaultCurrencyCode?: InputMaybe<CurrencyCode>;
  defaultLanguageCode?: InputMaybe<LanguageCode>;
  defaultShippingZoneId?: InputMaybe<Scalars['ID']['input']>;
  defaultTaxZoneId?: InputMaybe<Scalars['ID']['input']>;
  id: Scalars['ID']['input'];
  outOfStockThreshold?: InputMaybe<Scalars['Int']['input']>;
  pricesIncludeTax?: InputMaybe<Scalars['Boolean']['input']>;
  sellerId?: InputMaybe<Scalars['ID']['input']>;
  token?: InputMaybe<Scalars['String']['input']>;
  trackInventory?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdateChannelResult = Channel | LanguageNotAvailableError;

export type UpdateCollectionInput = {
  assetIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  featuredAssetId?: InputMaybe<Scalars['ID']['input']>;
  filters?: InputMaybe<Array<ConfigurableOperationInput>>;
  id: Scalars['ID']['input'];
  inheritFilters?: InputMaybe<Scalars['Boolean']['input']>;
  isPrivate?: InputMaybe<Scalars['Boolean']['input']>;
  parentId?: InputMaybe<Scalars['ID']['input']>;
  translations?: InputMaybe<Array<UpdateCollectionTranslationInput>>;
};

export type UpdateCollectionTranslationInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: LanguageCode;
  name?: InputMaybe<Scalars['String']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateCountryInput = {
  code?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
  translations?: InputMaybe<Array<CountryTranslationInput>>;
};

export type UpdateCustomerGroupInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateCustomerInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  emailAddress?: InputMaybe<Scalars['String']['input']>;
  firstName?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  lastName?: InputMaybe<Scalars['String']['input']>;
  phoneNumber?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateCustomerNoteInput = {
  note: Scalars['String']['input'];
  noteId: Scalars['ID']['input'];
};

export type UpdateCustomerResult = Customer | EmailAddressConflictError;

export type UpdateFacetInput = {
  code?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['ID']['input'];
  isPrivate?: InputMaybe<Scalars['Boolean']['input']>;
  translations?: InputMaybe<Array<FacetTranslationInput>>;
};

export type UpdateFacetValueInput = {
  code?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['ID']['input'];
  translations?: InputMaybe<Array<FacetValueTranslationInput>>;
};

export type UpdateGlobalSettingsInput = {
  availableLanguages?: InputMaybe<Array<LanguageCode>>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  outOfStockThreshold?: InputMaybe<Scalars['Int']['input']>;
  trackInventory?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdateGlobalSettingsResult = ChannelDefaultLanguageError | GlobalSettings;

export type UpdateMySellerOperationsProfileInput = {
  acceptsOrders?: InputMaybe<Scalars['Boolean']['input']>;
  businessHoursJson?: InputMaybe<BusinessHoursInput>;
  deliveryModel?: InputMaybe<Scalars['String']['input']>;
  fulfillmentMode?: InputMaybe<Scalars['String']['input']>;
  minOrderAmount?: InputMaybe<Scalars['Int']['input']>;
  operationalState?: InputMaybe<Scalars['String']['input']>;
  prepTimeMin?: InputMaybe<Scalars['Int']['input']>;
  primaryCategory?: InputMaybe<Scalars['String']['input']>;
  serviceAreaType?: InputMaybe<Scalars['String']['input']>;
  serviceLocalities?: InputMaybe<Array<Scalars['String']['input']>>;
  supportsScheduledOrders?: InputMaybe<Scalars['Boolean']['input']>;
  supportsSubstitutions?: InputMaybe<Scalars['Boolean']['input']>;
  /** Phase 2 — root collection IDs for tree-based taxonomy permissions */
  taxonomyRootCollectionIds?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type UpdateOrderAddressInput = {
  city?: InputMaybe<Scalars['String']['input']>;
  company?: InputMaybe<Scalars['String']['input']>;
  countryCode?: InputMaybe<Scalars['String']['input']>;
  fullName?: InputMaybe<Scalars['String']['input']>;
  phoneNumber?: InputMaybe<Scalars['String']['input']>;
  postalCode?: InputMaybe<Scalars['String']['input']>;
  province?: InputMaybe<Scalars['String']['input']>;
  streetLine1?: InputMaybe<Scalars['String']['input']>;
  streetLine2?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateOrderCustomFieldsInput = {
  juspayOrderId?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateOrderInput = {
  customFields?: InputMaybe<UpdateOrderCustomFieldsInput>;
  id: Scalars['ID']['input'];
};

/** Union type of all possible errors that can occur when adding or removing items from an Order. */
export type UpdateOrderItemErrorResult = InsufficientStockError | NegativeQuantityError | OrderInterceptorError | OrderLimitError | OrderModificationError;

export type UpdateOrderItemsResult = InsufficientStockError | NegativeQuantityError | Order | OrderInterceptorError | OrderLimitError | OrderModificationError;

export type UpdateOrderNoteInput = {
  isPublic?: InputMaybe<Scalars['Boolean']['input']>;
  note?: InputMaybe<Scalars['String']['input']>;
  noteId: Scalars['ID']['input'];
};

export type UpdatePaymentMethodInput = {
  checker?: InputMaybe<ConfigurableOperationInput>;
  code?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  handler?: InputMaybe<ConfigurableOperationInput>;
  id: Scalars['ID']['input'];
  translations?: InputMaybe<Array<PaymentMethodTranslationInput>>;
};

export type UpdateProductCustomFieldsInput = {
  sellerIsVerified?: InputMaybe<Scalars['Boolean']['input']>;
  sellerOnboardingStatus?: InputMaybe<Scalars['String']['input']>;
  sellerOperationalStatus?: InputMaybe<Scalars['String']['input']>;
  sellerPromotionActive?: InputMaybe<Scalars['Boolean']['input']>;
  sellerPromotionBannerEligible?: InputMaybe<Scalars['Boolean']['input']>;
  sellerPromotionBidBoost?: InputMaybe<Scalars['Int']['input']>;
  sellerPromotionCampaignId?: InputMaybe<Scalars['String']['input']>;
  sellerPromotionScore?: InputMaybe<Scalars['Int']['input']>;
};

export type UpdateProductInput = {
  assetIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  customFields?: InputMaybe<UpdateProductCustomFieldsInput>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  facetValueIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  featuredAssetId?: InputMaybe<Scalars['ID']['input']>;
  id: Scalars['ID']['input'];
  translations?: InputMaybe<Array<ProductTranslationInput>>;
};

export type UpdateProductOptionGroupInput = {
  code?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['ID']['input'];
  translations?: InputMaybe<Array<ProductOptionGroupTranslationInput>>;
};

export type UpdateProductOptionInput = {
  code?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['ID']['input'];
  translations?: InputMaybe<Array<ProductOptionGroupTranslationInput>>;
};

export type UpdateProductReviewInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  response?: InputMaybe<Scalars['String']['input']>;
  summary?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateProductVariantInput = {
  assetIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  facetValueIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  featuredAssetId?: InputMaybe<Scalars['ID']['input']>;
  id: Scalars['ID']['input'];
  optionIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  outOfStockThreshold?: InputMaybe<Scalars['Int']['input']>;
  /** Sets the price for the ProductVariant in the Channel's default currency */
  price?: InputMaybe<Scalars['Money']['input']>;
  /** Allows multiple prices to be set for the ProductVariant in different currencies. */
  prices?: InputMaybe<Array<UpdateProductVariantPriceInput>>;
  sku?: InputMaybe<Scalars['String']['input']>;
  stockLevels?: InputMaybe<Array<StockLevelInput>>;
  stockOnHand?: InputMaybe<Scalars['Int']['input']>;
  taxCategoryId?: InputMaybe<Scalars['ID']['input']>;
  trackInventory?: InputMaybe<GlobalFlag>;
  translations?: InputMaybe<Array<ProductVariantTranslationInput>>;
  useGlobalOutOfStockThreshold?: InputMaybe<Scalars['Boolean']['input']>;
};

/**
 * Used to set up update the price of a ProductVariant in a particular Channel.
 * If the `delete` flag is `true`, the price will be deleted for the given Channel.
 */
export type UpdateProductVariantPriceInput = {
  currencyCode: CurrencyCode;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  delete?: InputMaybe<Scalars['Boolean']['input']>;
  price: Scalars['Money']['input'];
};

export type UpdatePromotionInput = {
  actions?: InputMaybe<Array<ConfigurableOperationInput>>;
  conditions?: InputMaybe<Array<ConfigurableOperationInput>>;
  couponCode?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  endsAt?: InputMaybe<Scalars['DateTime']['input']>;
  id: Scalars['ID']['input'];
  perCustomerUsageLimit?: InputMaybe<Scalars['Int']['input']>;
  startsAt?: InputMaybe<Scalars['DateTime']['input']>;
  translations?: InputMaybe<Array<PromotionTranslationInput>>;
  usageLimit?: InputMaybe<Scalars['Int']['input']>;
};

export type UpdatePromotionPlanInput = {
  analyticsTier?: InputMaybe<Scalars['String']['input']>;
  code?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  maxActiveCampaigns?: InputMaybe<Scalars['Int']['input']>;
  maxBoostScore?: InputMaybe<Scalars['Int']['input']>;
  maxDailyBudget?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdatePromotionResult = MissingConditionsError | Promotion;

export type UpdateProvinceInput = {
  code?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
  translations?: InputMaybe<Array<ProvinceTranslationInput>>;
};

export type UpdateRoleInput = {
  channelIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  code?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  permissions?: InputMaybe<Array<Permission>>;
};

export type UpdateScheduledTaskInput = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['String']['input'];
};

export type UpdateSellerCashbackPolicyInput = {
  expiryDays?: InputMaybe<Scalars['Int']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  maxEarnPerOrderPaise?: InputMaybe<Scalars['Int']['input']>;
  maxRedemptionPct?: InputMaybe<Scalars['Int']['input']>;
  minOrderAmountPaise?: InputMaybe<Scalars['Int']['input']>;
  pendingDays?: InputMaybe<Scalars['Int']['input']>;
  rateType?: InputMaybe<Scalars['String']['input']>;
  rateValue?: InputMaybe<Scalars['Int']['input']>;
};

export type UpdateSellerCategoryPolicyInput = {
  allowedCollectionIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  allowedFacetIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  blockedFacetValueIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  code?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  moderationRules?: InputMaybe<Scalars['JSON']['input']>;
};

export type UpdateSellerCustomFieldsInput = {
  deliveryRadiusKm?: InputMaybe<Scalars['Float']['input']>;
  isVerified?: InputMaybe<Scalars['Boolean']['input']>;
  onboardingStatus?: InputMaybe<Scalars['String']['input']>;
  operationalStatus?: InputMaybe<Scalars['String']['input']>;
  razorpayLinkedAccountId?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateSellerInput = {
  customFields?: InputMaybe<UpdateSellerCustomFieldsInput>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateSellerOperationsProfileInput = {
  acceptsOrders?: InputMaybe<Scalars['Boolean']['input']>;
  businessHoursJson?: InputMaybe<BusinessHoursInput>;
  deliveryModel?: InputMaybe<Scalars['String']['input']>;
  fulfillmentMode?: InputMaybe<Scalars['String']['input']>;
  minOrderAmount?: InputMaybe<Scalars['Int']['input']>;
  operationalState?: InputMaybe<Scalars['String']['input']>;
  prepTimeMin?: InputMaybe<Scalars['Int']['input']>;
  primaryCategory?: InputMaybe<Scalars['String']['input']>;
  sellerId: Scalars['ID']['input'];
  serviceAreaType?: InputMaybe<Scalars['String']['input']>;
  serviceLocalities?: InputMaybe<Array<Scalars['String']['input']>>;
  supportsScheduledOrders?: InputMaybe<Scalars['Boolean']['input']>;
  supportsSubstitutions?: InputMaybe<Scalars['Boolean']['input']>;
  taxonomyRootCollectionIds?: InputMaybe<Array<Scalars['ID']['input']>>;
};

export type UpdateSellerPromotionInput = {
  bannerCtaLabel?: InputMaybe<Scalars['String']['input']>;
  bannerCtaUrl?: InputMaybe<Scalars['String']['input']>;
  bannerImageAssetId?: InputMaybe<Scalars['ID']['input']>;
  bannerSubtitle?: InputMaybe<Scalars['String']['input']>;
  bannerTitle?: InputMaybe<Scalars['String']['input']>;
  boostScore?: InputMaybe<Scalars['Int']['input']>;
  campaignId: Scalars['ID']['input'];
  collectionIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  endAt?: InputMaybe<Scalars['DateTime']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  startAt?: InputMaybe<Scalars['DateTime']['input']>;
};

export type UpdateShippingMethodInput = {
  calculator?: InputMaybe<ConfigurableOperationInput>;
  checker?: InputMaybe<ConfigurableOperationInput>;
  code?: InputMaybe<Scalars['String']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  fulfillmentHandler?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  translations: Array<ShippingMethodTranslationInput>;
};

export type UpdateStockLocationCustomFieldsInput = {
  city?: InputMaybe<Scalars['String']['input']>;
  latitude?: InputMaybe<Scalars['Float']['input']>;
  longitude?: InputMaybe<Scalars['Float']['input']>;
  postalCode?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateStockLocationInput = {
  customFields?: InputMaybe<UpdateStockLocationCustomFieldsInput>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateTagInput = {
  id: Scalars['ID']['input'];
  value?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateTaxCategoryInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['ID']['input'];
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateTaxRateInput = {
  categoryId?: InputMaybe<Scalars['ID']['input']>;
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  customerGroupId?: InputMaybe<Scalars['ID']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  value?: InputMaybe<Scalars['Float']['input']>;
  zoneId?: InputMaybe<Scalars['ID']['input']>;
};

export type UpdateZoneInput = {
  customFields?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpsertRedemptionConfigInput = {
  maxRedemptionAmountPaise?: InputMaybe<Scalars['Int']['input']>;
  maxRedemptionPct?: InputMaybe<Scalars['Int']['input']>;
};

export type UpsertSellerCashbackPolicyInput = {
  expiryDays?: InputMaybe<Scalars['Int']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  maxEarnPerOrderPaise?: InputMaybe<Scalars['Int']['input']>;
  maxRedemptionPct?: InputMaybe<Scalars['Int']['input']>;
  minOrderAmountPaise?: InputMaybe<Scalars['Int']['input']>;
  pendingDays?: InputMaybe<Scalars['Int']['input']>;
  rateType?: InputMaybe<Scalars['String']['input']>;
  rateValue?: InputMaybe<Scalars['Int']['input']>;
};

export type UpsertVariantCashbackPolicyInput = {
  endsAt?: InputMaybe<Scalars['DateTime']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  maxEarnPerLinePaise?: InputMaybe<Scalars['Int']['input']>;
  rateType: Scalars['String']['input'];
  rateValue: Scalars['Int']['input'];
  startsAt?: InputMaybe<Scalars['DateTime']['input']>;
};

export type User = Node & {
  authenticationMethods: Array<AuthenticationMethod>;
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  identifier: Scalars['String']['output'];
  lastLogin?: Maybe<Scalars['DateTime']['output']>;
  roles: Array<Role>;
  updatedAt: Scalars['DateTime']['output'];
  verified: Scalars['Boolean']['output'];
};

export type VariantCashbackPolicyListOptions = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type Webhook = {
  channelAgnostic: Scalars['Boolean']['output'];
  event: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  requestTransformer?: Maybe<WebhookRequestTransformer>;
  url: Scalars['String']['output'];
};

export type WebhookInput = {
  channelAgnostic?: InputMaybe<Scalars['Boolean']['input']>;
  event: Scalars['String']['input'];
  transformerName?: InputMaybe<Scalars['String']['input']>;
  url: Scalars['String']['input'];
};

export type WebhookRequestTransformer = {
  name: Scalars['String']['output'];
  supportedEvents: Array<Scalars['String']['output']>;
};

export type Zone = Node & {
  createdAt: Scalars['DateTime']['output'];
  customFields?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  members: Array<Region>;
  name: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ZoneFilterParameter = {
  _and?: InputMaybe<Array<ZoneFilterParameter>>;
  _or?: InputMaybe<Array<ZoneFilterParameter>>;
  createdAt?: InputMaybe<DateOperators>;
  id?: InputMaybe<IdOperators>;
  name?: InputMaybe<StringOperators>;
  updatedAt?: InputMaybe<DateOperators>;
};

export type ZoneList = PaginatedList & {
  items: Array<Zone>;
  totalItems: Scalars['Int']['output'];
};

export type ZoneListOptions = {
  /** Allows the results to be filtered */
  filter?: InputMaybe<ZoneFilterParameter>;
  /** Specifies whether multiple top-level "filter" fields should be combined with a logical AND or OR operation. Defaults to AND. */
  filterOperator?: InputMaybe<LogicalOperator>;
  /** Skips the first n results, for use in pagination */
  skip?: InputMaybe<Scalars['Int']['input']>;
  /** Specifies which properties to sort the results by */
  sort?: InputMaybe<ZoneSortParameter>;
  /** Takes n results, for use in pagination */
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type ZoneSortParameter = {
  createdAt?: InputMaybe<SortOrder>;
  id?: InputMaybe<SortOrder>;
  name?: InputMaybe<SortOrder>;
  updatedAt?: InputMaybe<SortOrder>;
};
