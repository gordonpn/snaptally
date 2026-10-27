export const BUCKET_SUBCATEGORIES = {
  "Guilt-Free": ["Dining", "Takeout", "Coffee & Snacks", "Bars", "Shopping", "Entertainment"],
  "Fixed Costs": [
    "Rent",
    "Utilities",
    "Groceries",
    "Subscriptions",
    "Transit",
    "Healthcare",
    "Fitness",
  ],
  Savings: ["Emergency Fund", "Investments", "Travel Fund"],
  Income: ["Salary", "Other"],
} as const;

export type ParentBucket = keyof typeof BUCKET_SUBCATEGORIES;
export type Subcategory = (typeof BUCKET_SUBCATEGORIES)[ParentBucket][number];

export const DEFAULT_FREQUENT_MERCHANTS: readonly string[] = [
  "Amazon Cafeteria",
  "Amazon",
  "Star Market",
  "Stop & Shop",
  "Parking",
  "Trader Joe's",
  "McDonald's",
  "Shaw's",
  "Greco",
  "Dig",
  "Gas",
  "Shake Shack",
  "Chipotle",
  "J Pace",
  "Yoki Express",
  "Uniqlo",
  "Bloc Shop",
  "CVS",
  "Berryline",
  "Marshall's",
];
