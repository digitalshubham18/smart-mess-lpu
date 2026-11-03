// ============================================================================
// Domain models — designed to map directly onto a future PostgreSQL schema.
// Every service in src/services currently reads/writes these shapes against
// mock data; swapping to a real API means changing only the service layer.
// ============================================================================

export type Role =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'MESS_MANAGER'
  | 'KITCHEN_STAFF'
  | 'STUDENT'
  | 'FINANCE_MANAGER'
  | 'HOSTEL_WARDEN'
  | 'PARENT'

export type MealType = 'breakfast' | 'lunch' | 'snacks' | 'dinner'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  avatarColor: string
  hostelId?: string
  studentId?: string
  phone?: string
  createdAt: string
  /** True while the account is still on a TEMPORARY password — the app (and the API) allow nothing but choosing a new one. */
  mustChangePassword?: boolean
  /** True once the person has turned on authenticator-app (TOTP) two-factor login. */
  twoFactorEnabled?: boolean
  /** Policy: this role MUST use two-factor (Admin, Super Admin by default). */
  twoFactorRequired?: boolean
  /** Required but not set up yet — the API allows only setting it up (or signing out) until it is. */
  twoFactorSetupRequired?: boolean
}

export interface Student {
  id: string
  name: string
  email: string
  phone: string
  hostelId: string
  room: string
  year: number
  branch: string
  mealPreference: 'veg' | 'non-veg' | 'either'
  status: 'active' | 'inactive'
  /** The student (or staff on their behalf) has agreed to the photo notice. */
  photoConsent?: boolean
  points: number
  badges: string[]
  missedCutoffCount: number
  /** Inclusive ISO date — while set and >= today, the student is treated as on leave: auto
   *  "will not eat" for every meal, excluded from live headcounts, no manual marking needed. */
  leaveUntil?: string
  /** True while the student holds a temporary TMP-xxxxx ID because they have no university UID yet. */
  provisional?: boolean
  /** Whether an official photo is on file (served behind login from /students/:id/photo). */
  hasPhoto?: boolean
}

export interface Hostel {
  id: string
  name: string
  category: 'boys' | 'girls' | 'general'
  capacity: number
  occupancy: number
}

export interface Mess {
  id: string
  name: string
  hostelIds: string[]
  seatingCapacity: number
  location: string
}

export interface MenuItem {
  id: string
  name: string
  category: 'Rice' | 'Pulses' | 'Bread' | 'Curry' | 'Dairy' | 'Salad' | 'Fruit' | 'Beverage' | 'Snack' | 'Sweet'
  veg: boolean
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  popularity: number // relative demand multiplier, learned from ratings/attendance
  servingSizeKg: number
  costPerKg: number
}

export interface Menu {
  id: string
  date: string // ISO date
  meal: MealType
  itemIds: string[]
  isSpecial?: boolean
  label?: string
}

export interface MealIntention {
  id: string
  studentId: string
  date: string
  meal: MealType
  status: 'will_eat' | 'will_not' | 'unconfirmed'
  submittedAt?: string
}

export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface MealChangeRequest {
  id: string
  messId: string
  studentId: string
  studentName: string
  date: string
  meal: MealType
  previousStatus: MealIntention['status']
  requestedStatus: 'will_eat' | 'will_not'
  reason: string
  status: ChangeRequestStatus
  createdAt: string
  resolvedBy?: string
  resolvedAt?: string
}

export interface Attendance {
  id: string
  date: string
  meal: MealType
  studentId: string
  hostelId: string
  scannedAt: string
  /** Staff user id who scanned the student's QR at the counter — absent only for older seed rows. */
  scannedBy?: string
}

export interface AttendanceWarning {
  id: string
  studentId: string
  messId: string
  date: string
  meal: MealType
  issuedAt: string
  reason: string
}

export interface AttendanceFine {
  id: string
  studentId: string
  messId: string
  amount: number
  /** "YYYY-MM" — a fine is scoped to the calendar month its triggering warnings fell in. */
  month: string
  issuedAt: string
  warningIds: string[]
  paid: boolean
}

export interface Forecast {
  id: string
  date: string
  meal: MealType
  method: ForecastMethod
  predictedStudents: number
  confidence: number
  recommendedQuantityKg: number
  expectedLeftover: number
  expectedWaste: number
  expectedCost: number
  safetyBufferPct: number
}

export type ForecastMethod =
  | 'historical_average'
  | 'moving_average'
  | 'weighted_moving_average'
  | 'exponential_smoothing'
  | 'linear_regression'
  | 'weekday_average'
  | 'random_forest'
  | 'xgboost'
  | 'lstm'

export interface ForecastResult {
  id: string
  date: string
  meal: MealType
  predicted: number
  actual: number
  difference: number
  absoluteError: number
  percentageError: number
}

export interface FoodPreparation {
  date: string
  meal: MealType
  itemId: string
  preparedKg: number
}

export interface FoodConsumption {
  date: string
  meal: MealType
  itemId: string
  consumedKg: number
}

export type WasteReason =
  | 'Overproduction'
  | 'Low attendance'
  | 'Poor taste'
  | 'Poor menu preference'
  | 'Spoilage'
  | 'Cooking error'
  | 'Excess serving'
  | 'Storage issue'
  | 'Other'

export interface FoodWaste {
  id: string
  messId: string
  date: string
  meal: MealType
  itemId: string
  preparedKg: number
  servedKg: number
  consumedKg: number
  leftoverKg: number
  wasteKg: number
  reason: WasteReason
  costPerKg: number
}

export interface InventoryItem {
  id: string
  messId: string
  name: string
  category: 'Rice' | 'Pulses' | 'Vegetables' | 'Fruits' | 'Dairy' | 'Spices' | 'Oil' | 'Flour' | 'Other'
  quantity: number
  unit: 'kg' | 'litres' | 'pieces'
  minStock: number
  maxStock: number
  expiryDate: string
  supplierId: string
  purchasePrice: number
  updatedAt: string
}

export interface Supplier {
  id: string
  name: string
  phone: string
  email: string
  address: string
  rating: number
  itemsSupplied: string[]
}

export type POStatus = 'Pending' | 'Approved' | 'Ordered' | 'Delivered' | 'Cancelled'

export interface PurchaseOrderItem {
  itemId: string
  quantity: number
  unit: string
  price: number
}

export interface PurchaseOrder {
  id: string
  messId: string
  poNumber: string
  supplierId: string
  items: PurchaseOrderItem[]
  total: number
  status: POStatus
  deliveryDate: string
  createdAt: string
}

export interface Feedback {
  id: string
  studentId: string
  date: string
  meal: MealType
  rating: number
  taste: number
  quality: number
  variety: number
  quantity: number
  comment?: string
}

export type ComplaintStatus = 'Open' | 'In Progress' | 'Resolved' | 'Rejected'

export interface Complaint {
  id: string
  studentId: string
  date: string
  category: string
  subject: string
  description: string
  status: ComplaintStatus
}

export interface Notification {
  id: string
  title: string
  message: string
  type: 'meal_reminder' | 'menu_update' | 'intention_reminder' | 'waste_alert' | 'inventory_alert' | 'expiry_alert' | 'forecast_update' | 'announcement' | 'change_request_update'
  read: boolean
  createdAt: string
  targetRoles?: Role[]
  targetStudentId?: string
}

export type EventType = 'holiday' | 'exam' | 'event' | 'festival' | 'sports' | 'vacation'

export interface CalendarEvent {
  id: string
  title: string
  date: string
  type: EventType
  demandImpactPct: number // e.g. -30 for vacation, +15 for festival
}

export interface Expense {
  id: string
  messId: string
  date: string
  category: 'ingredients' | 'labor' | 'utilities' | 'transport' | 'waste'
  amount: number
  description: string
}

export interface DailyReportSummary {
  date: string
  totalStudents: number
  totalMeals: number
  totalPreparedKg: number
  totalConsumedKg: number
  totalWasteKg: number
  wastePct: number
  forecastAccuracy: number
  totalCost: number
  wasteCost: number
  savings: number
}

export type AuditAction =
  | 'staff_added'
  | 'staff_removed'
  | 'hostel_created'
  | 'student_transferred'
  | 'change_request_resolved'
  | 'event_added'
  | 'event_updated'
  | 'event_deleted'
  | 'parent_access_granted'
  | 'meal_checked_in'
  | 'no_show_warning_issued'
  | 'no_show_fine_issued'
  | 'student_registered'
  | 'fine_paid'

export interface AuditLogEntry {
  id: string
  at: string // ISO timestamp
  actorId: string
  actorName: string
  actorRole: Role
  action: AuditAction
  messId?: string
  summary: string
}
