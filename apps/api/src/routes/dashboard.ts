import express from "express";
import { dashboardAuthMiddleware } from "../lib/dashboard-auth";
import {
  getApiKeys,
  createApiKey,
  deleteApiKey,
  updateApiKey,
} from "../controllers/dashboard/api-keys";
import {
  getTeamMembers,
  inviteTeamMember,
  removeTeamMember,
} from "../controllers/dashboard/team";
import {
  createCheckoutSession,
  createPortalSession,
  getCurrentBilling,
  updateAutoRecharge,
  getPlans,
} from "../controllers/dashboard/billing";
import {
  getPlanConfigs,
  updatePlanConfig,
  getAllTeams,
  getTeamDetails,
  setTeamFlags,
  addTeamCoupon,
} from "../controllers/dashboard/admin";
import { handleStripeWebhook } from "../controllers/dashboard/stripe-webhook";
import {
  getCreditUsage,
  getCreditUsageHistorical,
} from "../controllers/dashboard/credit-usage";
import { getQueueStatus } from "../controllers/dashboard/queue-status";
import { provisionAutumn } from "../controllers/dashboard/provision-autumn";
import {
  getOrganizations,
  createOrganization,
  getTeams,
  createTeam,
} from "../controllers/dashboard/organizations";

const router = express.Router();

// Stripe Webhook (no auth required) - register before middleware
router.post("/webhook/stripe", handleStripeWebhook);

// Apply dashboard auth middleware to all other routes
router.use(dashboardAuthMiddleware);

// Credit Usage
router.get("/credit-usage", getCreditUsage);
router.get("/credit-usage/historical", getCreditUsageHistorical);

// Autumn Provisioning
router.post("/provision-autumn", provisionAutumn);

// Organization Management (read-only to prevent manual creation)
router.get("/organizations", getOrganizations);
// router.post("/organizations", createOrganization); // Disabled to prevent multi-org abuse

// Team Management (read-only to prevent manual creation)
router.get("/teams", getTeams);
// router.post("/teams", createTeam); // Disabled to prevent multi-org abuse

// Queue Status
router.get("/queue-status", getQueueStatus);

// API Key management
router.get("/api-keys", getApiKeys);
router.post("/api-keys", createApiKey);
router.delete("/api-keys/:id", deleteApiKey);
router.patch("/api-keys/:id", updateApiKey);

// Team management
router.get("/team/members", getTeamMembers);
router.post("/team/invite", inviteTeamMember);
router.delete("/team/members/:userId", removeTeamMember);

// Billing
router.post("/billing/checkout", createCheckoutSession);
router.post("/billing/portal", createPortalSession);
router.get("/billing/current", getCurrentBilling);
router.patch("/billing/auto-recharge", updateAutoRecharge);
router.get("/billing/plans", getPlans);

// Admin routes (require admin role check in controllers)
router.get("/admin/plan-configs", getPlanConfigs);
router.put("/admin/plan-configs/:id", updatePlanConfig);
router.get("/admin/teams", getAllTeams);
router.get("/admin/teams/:id", getTeamDetails);
router.post("/admin/teams/:id/flags", setTeamFlags);
router.post("/admin/teams/:id/coupon", addTeamCoupon);

export { router as dashboardRouter };
