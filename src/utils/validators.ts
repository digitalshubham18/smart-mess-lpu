import { z } from 'zod'

export const loginSchema = z.object({
  identifier: z.string().min(3, 'Enter your registration number or email'),
  password: z.string().min(4, 'Password must be at least 4 characters'),
  remember: z.boolean().optional(),
})
export type LoginForm = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    uid: z.string().min(1, 'Enter your student UID'),
    name: z.string().min(2, 'Name is too short'),
    email: z.string().email('Enter a valid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
export type RegisterForm = z.infer<typeof registerSchema>

/** Last step of UID sign-up: choose a password (the student's name and email are already known). */
export const signupPasswordSchema = z
  .object({
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })
export type SignupPasswordForm = z.infer<typeof signupPasswordSchema>

/** Adding a student from their UID: the university record supplies the person, so only placement is typed. */
export const uidStudentSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  hostelId: z.string().min(1, 'Select a hostel'),
  room: z.string().min(1, 'Room is required'),
  year: z.number().min(1).max(6),
  branch: z.string().optional(),
  mealPreference: z.enum(['veg', 'non-veg', 'either']),
  status: z.enum(['active', 'inactive']),
})

export const forgotPasswordSchema = z.object({
  identifier: z.string().min(1, 'Enter your UID or email'),
})

export const resetPasswordSchema = z
  .object({
    code: z.string().length(6, 'Enter the 6-digit code from your email'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export const otpSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code'),
})

export const inventoryItemSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  category: z.enum(['Rice', 'Pulses', 'Vegetables', 'Fruits', 'Dairy', 'Spices', 'Oil', 'Flour', 'Other']),
  quantity: z.number().min(0, 'Must be 0 or more'),
  unit: z.enum(['kg', 'litres', 'pieces']),
  minStock: z.number().min(0),
  maxStock: z.number().min(0),
  expiryDate: z.string().min(1, 'Expiry date is required'),
  purchasePrice: z.number().min(0),
})
export type InventoryItemForm = z.infer<typeof inventoryItemSchema>

export const studentSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Enter a valid email address'),
  phone: z.string().min(8, 'Enter a valid phone number'),
  hostelId: z.string().min(1, 'Select a hostel'),
  room: z.string().min(1, 'Room is required'),
  year: z.number().min(1).max(5),
  branch: z.string().min(1),
  mealPreference: z.enum(['veg', 'non-veg', 'either']),
  status: z.enum(['active', 'inactive']),
})
export type StudentForm = z.infer<typeof studentSchema>

export const menuItemSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  category: z.enum(['Rice', 'Pulses', 'Bread', 'Curry', 'Dairy', 'Salad', 'Fruit', 'Beverage', 'Snack', 'Sweet']),
  veg: z.boolean(),
  calories: z.number().min(0),
  protein: z.number().min(0),
  servingSizeKg: z.number().min(0.01),
  costPerKg: z.number().min(0),
})
export type MenuItemForm = z.infer<typeof menuItemSchema>

export const complaintSchema = z.object({
  category: z.string().min(1, 'Select a category'),
  subject: z.string().min(3, 'Subject is too short'),
  description: z.string().min(10, 'Please provide a bit more detail'),
})
export type ComplaintForm = z.infer<typeof complaintSchema>

export const feedbackSchema = z.object({
  rating: z.number().min(1).max(5),
  taste: z.number().min(1).max(5),
  quality: z.number().min(1).max(5),
  variety: z.number().min(1).max(5),
  quantity: z.number().min(1).max(5),
  comment: z.string().optional(),
})
export type FeedbackForm = z.infer<typeof feedbackSchema>

export const supplierSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(8),
  email: z.string().email(),
  address: z.string().min(4),
  rating: z.number().min(1).max(5),
})
export type SupplierForm = z.infer<typeof supplierSchema>

/** Choosing a new password (profile + forced first sign-in). Mirrors the server's rules; the server is still the judge. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(8, 'Use at least 8 characters').max(128, 'Use at most 128 characters'),
    confirmPassword: z.string().min(1, 'Re-enter the new password'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: "The two passwords don't match" })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a password different from the current one' })
export type ChangePasswordForm = z.infer<typeof changePasswordSchema>
