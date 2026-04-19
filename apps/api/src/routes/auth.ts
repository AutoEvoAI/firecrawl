import express from "express";
import {
  handleSupabaseAuthWebhook,
  signupController,
  loginController,
  logoutController,
  getCurrentUserController,
} from "../controllers/auth-user";

const router = express.Router();

// Supabase auth webhook endpoint (no auth required)
// This webhook is triggered by Supabase when a user signs up
router.post("/webhook/supabase", handleSupabaseAuthWebhook);

// User signup endpoint (no auth required)
router.post("/signup", signupController);

// User login endpoint (no auth required)
router.post("/login", loginController);

// User logout endpoint (requires auth)
router.post("/logout", logoutController);

// Get current user endpoint (requires auth)
router.get("/me", getCurrentUserController);

export { router as authRouter };
