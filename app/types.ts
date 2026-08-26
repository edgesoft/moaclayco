export type OrderItem = {
  _id: string;
  itemRef?: string;
  templateItemRef?: string;
  inventoryMode?: "TRACKED" | "UNTRACKED";
  name: string;
  description?: string;
  longDescription?: string;
  image: string;
  finalImage?: string;
  quantity: number;
  price: number;
  additionalItems: Array<{
    _id?: string;
    name: string;
    price: number;
    packinfo: string;
  }>;
};

export type Order = {
  _id: string;
  checkoutToken?: string;
  createdAt?: Date | string;
  kind?: "STOREFRONT" | "SPECIAL";
  webhookAt?: Date | string,
  manualOrderAt?: Date | string,
  orderConfirmationEmailAt?: Date | string,
  shippingEmailAt?: Date | string,
  status?: "DRAFT" | "AWAITING_CUSTOMER" | "OPENED" | "PENDING" | "FAILED" | "CANCELED" | "SUCCESS" | "PAID_REVIEW" | "MANUAL_PROCESSING" | "SHIPPED";
  totalSum: number;
  paymentIntent?: {
    id: string;
    client_secret: string;
  };
  paymentIntentAliases?: string[];
  paidReviewReason?: string;
  customer: {
    firstname: string;
    lastname: string;
    email: string;
    postaddress: string;
    addressLine2?: string;
    zipcode: string;
    city: string;
    country?: string;
    phone?: string;
  };
  discount: {
    amount: number;
    percentage: number | undefined;
    code: string | undefined;
  };
  freightCost: number;
  items: OrderItem[];
  specialOrder?: {
    accessVersion?: number;
    addressConfirmedAt?: Date | string;
    expiresAt?: Date | string;
    expiryIncludesTime?: boolean;
    freightMode?: "AUTO" | "CUSTOM";
    lockedAt?: Date | string;
    publicOrigin?: string;
    publicTokenHash?: string;
    invitationHistory?: Array<{
      action: "REVOKED" | "REPLACED";
      at: Date | string;
      fromVersion: number;
      paymentIntentId?: string;
      toVersion?: number;
    }>;
    replacedAt?: Date | string;
    revokedAt?: Date | string;
    sentAt?: Date | string;
    termsAcceptedAt?: Date | string;
  };
  updatedAt?: Date | string;
};

export type CollectionProps = {
  _id?: string;
  image: string;
  headline: string;
  longDescription: string;
  shortDescription: string;
  instagram?: string;
  twitter?: string;
  shortUrl: string;
  index?: number;
  catalogStatus?: "active" | "deleted";
  deletedAt?: Date | string;
  deletionOperationId?: string;
  deletionUndoExpiresAt?: Date | string;
};

export type AdditionalItem = {
  _id?: string;
  price: number;
  name: string;
};

export type ItemProps = {
  _id: string;
  images: string[];
  amount: number;
  price: number;
  headline: string;
  collectionRef: string;
  productInfos?: string[];
  additionalItems?: AdditionalItem[];
  instagram?: string;
  longDescription?: string;
  catalogStatus?: "active" | "retired";
  retiredAt?: Date | string;
  retiredFromCollection?: string;
  lastCatalogOperationId?: string;
};

export type User = {
  _id: string;
  firstname: string;
  lastname: string;
  email: string;
  fiscalYear: number;
  googleSubject?: string;
  authProvider?: "google";
};

export type AdditionalItemProps = {
  item: AdditionalItem;
  handleSwitch: (
    item: AdditionalItem,
    on: boolean,
    additionalIndex: number
  ) => void;
  additionalIndex: number;
};

export type AdditionCartItemType = {
  item: AdditionalItem;
  index: number;
  additionalIndex: number;
};

export type DiscountType = {
  _id: string;
  percentage: number;
  code: string;
  balance: number;
  expireAt: Date | string | null;
};


export enum ReportType  {
  INCOME,
  BALANCE,
  EXPENSE,
  LIABILITIES,
  NONE
}

export type VerificationProps = {
  recordType?: "journal" | "vatReport" | "incomingBalance";
  journalEntries: Array<{
    _id?: string;
    debit: number;
    credit: number;
    account: number;
  }>;
  verificationNumber: number;
  verificationDate: string;
  description: string;
  files: Array<{
    name: string;
    path: string;
  }>;
  metadata: Array<{
    key: string;
    value: string;
  }>;
};
