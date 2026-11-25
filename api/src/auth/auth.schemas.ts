import { z } from 'zod';

export const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Full name is required').max(120),
  email: z.email('Please provide a valid email address').transform((e) => e.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters long').max(128),
});
export type SignUp = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});
export type SignIn = z.infer<typeof signInSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type Refresh = z.infer<typeof refreshSchema>;

export const signOutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type SignOut = z.infer<typeof signOutSchema>;
