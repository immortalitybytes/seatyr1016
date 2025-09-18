import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14.18.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2023-10-16",
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Parse request body
    const { userId, action } = await req.json();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing user ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["cancel", "reactivate"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find user's subscription in Supabase
    const { data: subscriptions, error: fetchError } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due"])
      .limit(1);

    if (fetchError) {
      throw new Error(`Error fetching subscription: ${fetchError.message}`);
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ error: "No active subscription found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeSubscriptionId = subscriptions[0].stripe_subscription_id;

    if (!stripeSubscriptionId) {
      return new Response(JSON.stringify({ error: "Invalid subscription record" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle subscription cancellation or reactivation
    if (action === "cancel") {
      // Cancel at period end to maintain access until the end of the billing period
      const updatedSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      // Update our database
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({ 
          cancel_at_period_end: true,
          cancel_at: updatedSubscription.cancel_at ? new Date(updatedSubscription.cancel_at * 1000).toISOString() : null,
          last_stripe_sync: new Date().toISOString()
        })
        .eq("stripe_subscription_id", stripeSubscriptionId);

      if (updateError) {
        throw new Error(`Error updating subscription: ${updateError.message}`);
      }

      return new Response(
        JSON.stringify({ 
          message: "Subscription will be canceled at the end of the billing period",
          currentPeriodEnd: new Date(updatedSubscription.current_period_end * 1000).toISOString()
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else if (action === "reactivate") {
      // Reactivate subscription
      const updatedSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      // Update our database
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({ 
          cancel_at_period_end: false,
          cancel_at: null,
          last_stripe_sync: new Date().toISOString()
        })
        .eq("stripe_subscription_id", stripeSubscriptionId);

      if (updateError) {
        throw new Error(`Error updating subscription: ${updateError.message}`);
      }

      return new Response(
        JSON.stringify({ 
          message: "Subscription has been reactivated",
          currentPeriodEnd: new Date(updatedSubscription.current_period_end * 1000).toISOString()
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Should never reach here due to action validation above
    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error processing request:", error);
    
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});