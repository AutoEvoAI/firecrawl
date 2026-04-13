import { Request, Response } from "express";
import Stripe from "stripe";
import { supabase_service } from "../../services/supabase";
import { logger } from "../../lib/logger";
import { config } from "../../config";

const stripe = new Stripe(config.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = config.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.error("STRIPE_WEBHOOK_SECRET not configured");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error("Webhook signature verification failed", { err });
    return res.status(400).json({ error: "Invalid signature" });
  }

  logger.info(`Received Stripe webhook: ${event.type}`);

  try {
    switch (event.type) {
      case "customer.subscription.created":
        await handleSubscriptionCreated(event);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event);
        break;
      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    logger.error("Error processing webhook", { err, eventType: event.type });
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

async function handleSubscriptionCreated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  
  // Get or create customer record
  const customerId = subscription.customer as string;
  const { data: existingCustomer } = await supabase_service
    .from("customers")
    .select("*")
    .eq("stripe_customer_id", customerId)
    .single();

  let teamId: string;
  
  if (existingCustomer) {
    // Find team_id from user_teams
    const { data: userTeam } = await supabase_service
      .from("user_teams")
      .select("team_id")
      .eq("user_id", existingCustomer.id)
      .single();
    
    teamId = userTeam?.team_id;
  } else {
    // Create new customer (this shouldn't happen in normal flow)
    logger.warn("Subscription created for unknown customer", { customerId });
    return;
  }

  if (!teamId) {
    logger.warn("No team found for customer", { customerId });
    return;
  }

  // Insert subscription record
  const { error } = await supabase_service.from("subscriptions").insert({
    team_id: teamId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId,
    stripe_price_id: subscription.items.data[0].price.id,
    status: subscription.status,
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    cancel_at_period_end: subscription.cancel_at_period_end,
    is_extract: false, // Default to false, may need metadata
  });

  if (error) {
    logger.error("Failed to insert subscription", { error, subscriptionId: subscription.id });
  }
}

async function handleSubscriptionUpdated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = subscription.customer as string;

  // Update subscription record
  const { error } = await supabase_service
    .from("subscriptions")
    .update({
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      stripe_price_id: subscription.items.data[0].price.id,
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) {
    logger.error("Failed to update subscription", { error, subscriptionId: subscription.id });
  }
}

async function handleSubscriptionDeleted(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;

  // Update subscription status
  const { error } = await supabase_service
    .from("subscriptions")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) {
    logger.error("Failed to delete subscription", { error, subscriptionId: subscription.id });
  }
}

async function handleInvoicePaid(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = invoice.subscription as string;

  if (!subscriptionId) {
    return;
  }

  // Update subscription period if needed
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  
  const { error } = await supabase_service
    .from("subscriptions")
    .update({
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId);

  if (error) {
    logger.error("Failed to update subscription from invoice", { error, subscriptionId });
  }
}

async function handleInvoicePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = invoice.customer as string;

  logger.warn("Invoice payment failed", { customerId, invoiceId: invoice.id });
  
  // Could send notification email here
  // Could update team status or flags
}
