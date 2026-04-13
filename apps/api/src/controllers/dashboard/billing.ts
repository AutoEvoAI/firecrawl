import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { config } from "../../config";
import { DashboardAuthRequest } from "../../lib/dashboard-auth";

const supabase = createClient(
  config.SUPABASE_URL || "",
  config.SUPABASE_SERVICE_TOKEN || "",
);

const stripe = new Stripe(config.STRIPE_SECRET_KEY || "");

export async function createCheckoutSession(
  req: DashboardAuthRequest,
  res: Response,
) {
  try {
    const { teamId } = req.auth!;
    const { priceId, successUrl, cancelUrl } = req.body;

    if (!priceId || !successUrl || !cancelUrl) {
      return res.status(400).json({
        error: "priceId, successUrl, and cancelUrl are required",
      });
    }

    // Get or create Stripe customer
    const { data: customerData } = await supabase
      .from("customers")
      .select("stripe_customer_id")
      .eq("team_id", teamId)
      .single();

    let customerId = customerData?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { team_id: teamId },
      });
      customerId = customer.id;

      await supabase.from("customers").insert({
        id: teamId,
        stripe_customer_id: customerId,
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    res.json({ checkoutUrl: session.url });
  } catch (error) {
    console.error("Create checkout session error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
}

export async function createPortalSession(
  req: DashboardAuthRequest,
  res: Response,
) {
  try {
    const { teamId } = req.auth!;
    const { returnUrl } = req.body;

    if (!returnUrl) {
      return res.status(400).json({ error: "returnUrl is required" });
    }

    const { data: customerData } = await supabase
      .from("customers")
      .select("stripe_customer_id")
      .eq("team_id", teamId)
      .single();

    if (!customerData?.stripe_customer_id) {
      return res.status(404).json({ error: "No Stripe customer found" });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerData.stripe_customer_id,
      return_url: returnUrl,
    });

    res.json({ portalUrl: session.url });
  } catch (error) {
    console.error("Create portal session error:", error);
    res.status(500).json({ error: "Failed to create portal session" });
  }
}

export async function getCurrentBilling(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;

    // Get current subscription
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select(`
        *,
        plan_configs (
          id,
          display_name,
          price_credits,
          concurrency,
          extract_concurrency
        )
      `)
      .eq("team_id", teamId)
      .in("status", ["active", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Get auto-recharge settings
    const { data: teamData } = await supabase
      .from("teams")
      .select("auto_recharge, auto_recharge_threshold")
      .eq("id", teamId)
      .single();

    res.json({
      subscription: subscription
        ? {
            planName: subscription.plan_configs?.display_name || "Free",
            priceCredits: subscription.plan_configs?.price_credits || 500,
            concurrency: subscription.plan_configs?.concurrency || 2,
            extractConcurrency:
              subscription.plan_configs?.extract_concurrency || 2,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
            nextBillingDate: subscription.current_period_end,
          }
        : {
            planName: "Free",
            priceCredits: 500,
            concurrency: 2,
            extractConcurrency: 2,
            status: "none",
          },
      autoRecharge: teamData?.auto_recharge || false,
      autoRechargeThreshold: teamData?.auto_recharge_threshold || 1000,
    });
  } catch (error) {
    console.error("Get current billing error:", error);
    res.status(500).json({ error: "Failed to fetch billing information" });
  }
}

export async function updateAutoRecharge(
  req: DashboardAuthRequest,
  res: Response,
) {
  try {
    const { teamId } = req.auth!;
    const { autoRecharge, autoRechargeThreshold } = req.body;

    const { error } = await supabase
      .from("teams")
      .update({
        auto_recharge: autoRecharge,
        auto_recharge_threshold: autoRechargeThreshold,
      })
      .eq("id", teamId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Update auto-recharge error:", error);
    res.status(500).json({ error: "Failed to update auto-recharge settings" });
  }
}
