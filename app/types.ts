export type OrderItem = {
  _id: string;
  itemRef: string;
  name: string;
  image: string;
  quantity: number;
  price: number;
  additionalItems: Array<{
    name: string;
    price: number;
    packinfo: string;
  }>;
};

export type Order = {
  domain: string,
  _id: string;
  webhookAt?: Date | string,
  manualOrderAt?: Date | string,
  orderConfirmationEmailAt?: Date | string,
  shippingEmailAt?: Date | string,
  status?: "OPENED" | "PENDING" | "FAILED" | "CANCELED" | "SUCCESS" | "PAID_REVIEW" | "MANUAL_PROCESSING" | "SHIPPED";
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
    zipcode: string;
    city: string;
  };
  discount: {
    amount: number;
    percentage: number | undefined;
    code: string | undefined;
  };
  freightCost: number;
  items: OrderItem[];
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
};

export type AdditionalItem = {
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

export type VerificationDomain = {
  domain: string
  verificationYear: number
}
