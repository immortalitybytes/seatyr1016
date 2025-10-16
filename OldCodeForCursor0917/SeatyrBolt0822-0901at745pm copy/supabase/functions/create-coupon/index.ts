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
    // Check if user is admin (in a production app, use a more robust method)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract token and verify user
    const token = authHeader.split(" ")[1];
    const { data: userData, error: authError } = await supabase.auth.getUser(token);

    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Very basic admin check - in production, use a proper role system
    const adminEmails = ["your-admin-email@example.com", "danabrams999@yahoo.com", "dan@corpania.com"];
    const isAdmin = adminEmails.includes(userData.user.email?.toLowerCase() || "");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Unauthorized. Admin privileges required." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request parameters
    const { code, percentOff, duration = "once" } = await req.json();

    if (!code || !percentOff) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["once", "forever", "repeating"].includes(duration)) {
      return new Response(JSON.stringify({ error: "Invalid duration. Must be 'once', 'forever', or 'repeating'." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create the coupon in Stripe
    const coupon = await stripe.coupons.create({
      percent_off: percentOff,
      duration: duration,
      name: code.toUpperCase(),
      id: code.toLowerCase(),
      max_redemptions: 100,  // Limit the number of redemptions
    });

    // Add a promotion code that users can enter
    const promotionCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: code.toUpperCase(),
      active: true,
    });

    // Optionally store the coupon in your database
    await supabase
      .from('coupon_codes')
      .insert({
        code: promotionCode.code,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days from now
      });

    return new Response(
      JSON.stringify({
        success: true,
        coupon: coupon,
        promotionCode: promotionCode,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error creating coupon:", error);
    
    return new Response(
      JSON.stringify({ error: error.message || "Failed to create coupon" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});