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
const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, stripe-signature, Authorization"
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
    // Log key information
    console.log("Webhook received");
    
    // Get the signature from headers
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing Stripe signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Get the raw body
    const body = await req.text();
    
    // Verify the signature
    let event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, stripeWebhookSecret);
    } catch (err) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return new Response(JSON.stringify({ error: `Webhook Error: ${err.message}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Webhook event type: ${event.type}`);

    // Handle different event types
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log(`Webhook: checkout.session.completed for session ${session.id}`);
        
        // Record the event in webhook_logs
        await supabase.from('webhook_logs').insert({
          event_type: event.type,
          event_id: event.id,
          status: 'processing',
          raw_event: event.data.object,
        });

        // Only handle subscription checkouts
        if (session.mode !== 'subscription') {
          console.log('Not a subscription checkout - skipping');
          return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get customer and subscription details
        const customer = await stripe.customers.retrieve(session.customer);
        const subscription = await stripe.subscriptions.retrieve(session.subscription);

        // Find user by customer email
        const { data: users, error: userError } = await supabase
          .from('auth.users')
          .select('id, email')
          .eq('email', customer.email)
          .limit(1);
          
        if (userError || !users || users.length === 0) {
          console.error(`User not found for email: ${customer.email}`);
          await supabase.from('webhook_logs').update({
            status: 'error',
            error: `User not found for email: ${customer.email}`,
          }).eq('event_id', event.id);
          break;
        }
        
        const userId = users[0].id;

        // Create or update subscription record
        const { error: subscriptionError } = await supabase
          .from('subscriptions')
          .upsert({
            user_id: userId,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            status: subscription.status,
            price_id: subscription.items.data[0].price.id,
            quantity: subscription.items.data[0].quantity,
            cancel_at_period_end: subscription.cancel_at_period_end,
            created: new Date(subscription.created * 1000).toISOString(),
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
            trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
            last_stripe_sync: new Date().toISOString()
          });

        if (subscriptionError) {
          console.error(`Error creating subscription: ${subscriptionError.message}`);
          await supabase.from('webhook_logs').update({
            status: 'error',
            error: `Error creating subscription: ${subscriptionError.message}`,
          }).eq('event_id', event.id);
        } else {
          await supabase.from('webhook_logs').update({
            status: 'completed',
          }).eq('event_id', event.id);
          console.log(`Subscription created for user ${userId}`);
        }
        break;
      }
        
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        console.log(`Webhook: customer.subscription.updated for subscription ${subscription.id}`);
        
        // Record the event
        await supabase.from('webhook_logs').insert({
          event_type: event.type,
          event_id: event.id,
          status: 'processing',
          raw_event: event.data.object,
        });

        // Update the subscription in our database
        const { error: updateError } = await supabase
          .from('subscriptions')
          .update({
            status: subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
            cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
            last_stripe_sync: new Date().toISOString()
          })
          .eq('stripe_subscription_id', subscription.id);

        if (updateError) {
          console.error(`Error updating subscription: ${updateError.message}`);
          await supabase.from('webhook_logs').update({
            status: 'error',
            error: `Error updating subscription: ${updateError.message}`,
          }).eq('event_id', event.id);
        } else {
          await supabase.from('webhook_logs').update({
            status: 'completed',
          }).eq('event_id', event.id);
          console.log(`Subscription updated: ${subscription.id}`);
        }
        break;
      }
        
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        console.log(`Webhook: customer.subscription.deleted for subscription ${subscription.id}`);
        
        // Record the event
        await supabase.from('webhook_logs').insert({
          event_type: event.type,
          event_id: event.id,
          status: 'processing',
          raw_event: event.data.object,
        });

        // Update the subscription record to show it's been canceled
        const { error: updateError } = await supabase
          .from('subscriptions')
          .update({
            status: 'canceled',
            canceled_at: new Date(subscription.canceled_at * 1000).toISOString(),
            ended_at: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : new Date().toISOString(),
            last_stripe_sync: new Date().toISOString()
          })
          .eq('stripe_subscription_id', subscription.id);

        if (updateError) {
          console.error(`Error updating deleted subscription: ${updateError.message}`);
          await supabase.from('webhook_logs').update({
            status: 'error',
            error: `Error updating deleted subscription: ${updateError.message}`,
          }).eq('event_id', event.id);
        } else {
          await supabase.from('webhook_logs').update({
            status: 'completed',
          }).eq('event_id', event.id);
          console.log(`Subscription deletion processed: ${subscription.id}`);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        console.log(`Webhook: invoice.payment_succeeded for invoice ${invoice.id}`);
        
        // Record the event
        await supabase.from('webhook_logs').insert({
          event_type: event.type,
          event_id: event.id,
          status: 'processing',
          raw_event: event.data.object,
        });

        // Only process subscription invoices
        if (!invoice.subscription) {
          console.log('Not a subscription invoice - skipping');
          await supabase.from('webhook_logs').update({
            status: 'skipped',
          }).eq('event_id', event.id);
          break;
        }

        // Get subscription details
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);

        // Update our database
        const { error: updateError } = await supabase
          .from('subscriptions')
          .update({
            status: subscription.status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            last_stripe_sync: new Date().toISOString()
          })
          .eq('stripe_subscription_id', invoice.subscription);

        if (updateError) {
          console.error(`Error updating subscription after invoice payment: ${updateError.message}`);
          await supabase.from('webhook_logs').update({
            status: 'error',
            error: `Error updating subscription: ${updateError.message}`,
          }).eq('event_id', event.id);
        } else {
          await supabase.from('webhook_logs').update({
            status: 'completed',
          }).eq('event_id', event.id);
          console.log(`Subscription updated after invoice payment: ${invoice.subscription}`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.log(`Webhook: invoice.payment_failed for invoice ${invoice.id}`);
        
        // Record the event
        await supabase.from('webhook_logs').insert({
          event_type: event.type,
          event_id: event.id,
          status: 'processing',
          raw_event: event.data.object,
        });

        // Only process subscription invoices
        if (!invoice.subscription) {
          console.log('Not a subscription invoice - skipping');
          await supabase.from('webhook_logs').update({
            status: 'skipped',
          }).eq('event_id', event.id);
          break;
        }

        // Get subscription details
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);

        // Update our database
        const { error: updateError } = await supabase
          .from('subscriptions')
          .update({
            status: subscription.status,  // Will be 'past_due' or 'unpaid'
            last_stripe_sync: new Date().toISOString()
          })
          .eq('stripe_subscription_id', invoice.subscription);

        if (updateError) {
          console.error(`Error updating subscription after invoice failed: ${updateError.message}`);
          await supabase.from('webhook_logs').update({
            status: 'error',
            error: `Error updating subscription: ${updateError.message}`,
          }).eq('event_id', event.id);
        } else {
          await supabase.from('webhook_logs').update({
            status: 'completed',
          }).eq('event_id', event.id);
          console.log(`Subscription updated after failed payment: ${invoice.subscription}`);
        }
        break;
      }

      default:
        console.log(`Unhandled webhook event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`Webhook error: ${error.message}`);
    return new Response(
      JSON.stringify({ error: `Webhook error: ${error.message}` }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});