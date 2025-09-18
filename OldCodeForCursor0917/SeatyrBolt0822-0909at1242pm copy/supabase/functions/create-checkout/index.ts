import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14.18.0";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize Stripe
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2023-10-16",
});

const PRICE_ID = "price_1OuYv2GvCIKVc1xxR48vMVNw"; // Replace with your actual price ID
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
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
    // Log request received
    console.log("Create checkout request received");
    
    // Get request body
    const body = await req.text();
    console.log("Request body:", body);
    
    let userId;
    try {
      const jsonData = JSON.parse(body);
      userId = jsonData.userId;
    } catch (err) {
      console.error("Error parsing request body:", err);
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing user ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's email
    console.log("Getting user data for ID:", userId);
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    
    if (userError || !userData?.user?.email) {
      console.error("User error:", userError);
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = userData.user.email;
    console.log("User email:", email);
    
    // Check if user already has a Stripe customer
    const { data: subscriptions, error: subError } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .not("stripe_customer_id", "is", null)
      .limit(1);
      
    let customerId: string;
    
    if (subError) {
      console.error("Error checking existing customer:", subError);
    }
    
    // Use existing customer ID if available
    if (subscriptions && subscriptions.length > 0 && subscriptions[0].stripe_customer_id) {
      customerId = subscriptions[0].stripe_customer_id;
      console.log("Using existing customer ID:", customerId);
    } else {
      // Create a new Stripe customer
      console.log("Creating new Stripe customer");
      const customer = await stripe.customers.create({
        email: email,
        metadata: { userId },
      });
      customerId = customer.id;
      console.log("Created new customer:", customerId);
    }

    // Define success and cancel URLs
    const client_url = req.headers.get("origin") || (Deno.env.get("CLIENT_URL") || "https://seatyr.netlify.app");
    const successUrl = `${client_url}/premium/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${client_url}/premium/cancel`;

    // Create a Stripe checkout session
    console.log("Creating checkout session");
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
      },
    });

    console.log("Checkout session created:", session.id);
    return new Response(
      JSON.stringify({ sessionId: session.id, url: session.url }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error creating checkout session:", error);
    
    return new Response(
      JSON.stringify({ error: error.message || "Failed to create checkout session" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});