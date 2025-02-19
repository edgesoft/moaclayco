export type OrderItem = {
  _id: string;
  itemRef: string;
  name: string;
  image: string;
  quantity: number;
  price: number;
  additionalItems: [
    {
      name: string;
      price: number;
      packinfo: string;
    }
  ];
};

export type Order = {
  domain: string,
  _id: string;
  webhookAt?: Date,
  manualOrderAt?: Date,
  totalSum: number;
  paymentIntent?: {
    id: string;
    client_secret: string;
  };
  customer: {
    firstname: string;
    lastname: string;
    email: string;
  };
  discount: {
    amount: number;
    percentage: number | undefined;
    code: string | undefined;
  };
  freightCost: number;
  items: [OrderItem];
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
  expireAt: Date | null;
};


export enum ReportType  {
  INCOME,
  BALANCE,
  EXPENSE,
  LIABILITIES,
  NONE
}

export type VerificationProps = {
  journalEntries: [
    {
      debit: number;
      credit: number;
      account: number;
    }
  ];
  verificationNumber: number;
  verificationDate: string;
  description: string;
  files: [
    {
      name: string;
      path: string;
    }
  ];
  metadata: [
    {
      key: string;
      value: string;
    }
  ]
};

export type VerificationDomain = {
  domain: string
  verificationYear: number
}