#!/usr/bin/env python3
"""
Firecrawl Billing Services Initialization Script

This script automatically configures Autumn and Stripe products/prices based on
the plan_configs table in Supabase. It supports idempotent execution and
incremental updates.

Usage:
    python scripts/init-billing-services.py --dry-run
    python scripts/init-billing-services.py --autumn-only
    python scripts/init-billing-services.py --stripe-only

Environment Variables Required:
    - SUPABASE_POSTGRES_HOST
    - SUPABASE_POSTGRES_USER
    - SUPABASE_POSTGRES_PASSWORD
    - AUTUMN_SECRET_KEY
    - STRIPE_SECRET_KEY

Note on SSL Errors:
    If you encounter "[SSL] record layer failure" errors, this is likely due to:
    1. Network proxy interference with TLS handshakes
    2. Python 3.13 SSL/TLS compatibility issues
    3. Corporate firewall or VPN settings
    
    Workarounds:
    - Use --no-verify-ssl flag to disable SSL verification (may not work for all cases)
    - Configure Autumn and Stripe manually using their dashboards (see docs/AUTUMN_CONFIG_GUIDE.md)
    - Try running from a different network environment
    - Consider using Python 3.11 or 3.12 if the issue persists
"""

import os
import sys
import argparse
import json
from typing import Dict, List, Optional
from pathlib import Path
from dotenv import load_dotenv
import httpx
import psycopg2

# ANSI color codes for terminal output
class Colors:
    RESET = '\x1b[0m'
    BRIGHT = '\x1b[1m'
    RED = '\x1b[31m'
    GREEN = '\x1b[32m'
    YELLOW = '\x1b[33m'
    BLUE = '\x1b[34m'
    CYAN = '\x1b[36m'

def log(message, color='RESET'):
    print(f"{getattr(Colors, color)}{message}{Colors.RESET}")

def error(message):
    log(f"ERROR: {message}", 'RED')

def success(message):
    log(f"✓ {message}", 'GREEN')

def info(message):
    log(f"ℹ {message}", 'CYAN')

def warn(message):
    log(f"⚠ {message}", 'YELLOW')

class SupabaseClient:
    """Simple Supabase client for reading plan_configs using PostgreSQL."""
    
    def __init__(self, db_host: str, db_user: str, db_password: str):
        self.db_host = db_host
        self.db_user = db_user
        self.db_password = db_password
        self.connection = None
    
    def get_connection(self):
        """Get PostgreSQL connection."""
        if not self.connection:
            connection_string = f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:5432/postgres"
            self.connection = psycopg2.connect(connection_string)
        return self.connection
    
    def get_plan_configs(self) -> List[Dict]:
        """Fetch all plan configs from Supabase."""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, name, max_credits, max_concurrent_requests, max_team_members, features, is_active
            FROM public.plan_configs
            WHERE is_active = true
            ORDER BY max_credits
        """)
        
        columns = [desc[0] for desc in cursor.description]
        plans = []
        for row in cursor.fetchall():
            plan_dict = dict(zip(columns, row))
            plans.append(plan_dict)
        
        cursor.close()
        return plans
    
    def update_plan_config(self, plan_id: str, metadata: Dict) -> bool:
        """Update plan config with external service IDs."""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # This would need to be implemented if we want to write back to the database
        # For now, this is not needed for the initialization script
        cursor.close()
        return True
    
    def close(self):
        """Close database connection."""
        if self.connection:
            self.connection.close()
            self.connection = None

class AutumnClient:
    """Autumn API client for feature/plan configuration."""
    
    def __init__(self, secret_key: str, base_url: str = "https://api.autumn.com/v1", verify_ssl: bool = True):
        self.secret_key = secret_key
        self.base_url = base_url
        self.verify_ssl = verify_ssl
        self.headers = {
            'Authorization': f'Bearer {secret_key}',
            'Content-Type': 'application/json'
        }
    
    def _get_client(self):
        """Get httpx client with appropriate SSL settings."""
        return httpx.Client(verify=self.verify_ssl)
    
    def list_features(self) -> List[Dict]:
        """List all features in Autumn."""
        with self._get_client() as client:
            response = client.get(
                f"{self.base_url}/features",
                headers=self.headers,
                timeout=30.0
            )
            if response.status_code == 404:
                return []
            response.raise_for_status()
            return response.json()
    
    def get_feature(self, feature_id: str) -> Optional[Dict]:
        """Get a feature by ID."""
        with self._get_client() as client:
            response = client.get(
                f"{self.base_url}/features/{feature_id}",
                headers=self.headers,
                timeout=30.0
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()
    
    def create_feature(self, feature_id: str, name: str, feature_type: str = "numeric") -> Dict:
        """Create a new feature in Autumn."""
        with self._get_client() as client:
            response = client.post(
                f"{self.base_url}/features",
                headers=self.headers,
                json={
                    'id': feature_id,
                    'name': name,
                    'type': feature_type
                },
                timeout=30.0
            )
            response.raise_for_status()
            return response.json()
    
    def list_plans(self) -> List[Dict]:
        """List all plans in Autumn."""
        with self._get_client() as client:
            response = client.get(
                f"{self.base_url}/plans",
                headers=self.headers,
                timeout=30.0
            )
            if response.status_code == 404:
                return []
            response.raise_for_status()
            return response.json()
    
    def get_plan(self, plan_id: str) -> Optional[Dict]:
        """Get a plan by ID."""
        with self._get_client() as client:
            response = client.get(
                f"{self.base_url}/plans/{plan_id}",
                headers=self.headers,
                timeout=30.0
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()
    
    def create_plan(self, plan_id: str, name: str, max_credits: int, max_team_members: int, auto_enable: bool = False) -> Dict:
        """Create a new plan in Autumn."""
        payload = {
            'planId': plan_id,
            'name': name,
            'autoEnable': auto_enable,
            'items': [
                {
                    'featureId': 'CREDITS',
                    'included': max_credits,
                    'unlimited': False,
                    'reset': {'interval': 'month'}
                },
                {
                    'featureId': 'TEAM',
                    'included': max_team_members,
                    'unlimited': False
                }
            ]
        }
        with self._get_client() as client:
            response = client.post(
                f"{self.base_url}/plans",
                headers=self.headers,
                json=payload,
                timeout=30.0
            )
            response.raise_for_status()
            return response.json()
    
    def update_plan(self, plan_id: str, max_credits: int, max_team_members: int) -> Dict:
        """Update an existing plan in Autumn."""
        payload = {
            'items': [
                {
                    'featureId': 'CREDITS',
                    'included': max_credits,
                    'unlimited': False,
                    'reset': {'interval': 'month'}
                },
                {
                    'featureId': 'TEAM',
                    'included': max_team_members,
                    'unlimited': False
                }
            ]
        }
        with self._get_client() as client:
            response = client.patch(
                f"{self.base_url}/plans/{plan_id}",
                headers=self.headers,
                json=payload,
                timeout=30.0
            )
            response.raise_for_status()
            return response.json()

class StripeClient:
    """Stripe API client for product/price configuration."""
    
    def __init__(self, secret_key: str, base_url: str = "https://api.stripe.com/v1", verify_ssl: bool = True):
        self.secret_key = secret_key
        self.base_url = base_url
        self.verify_ssl = verify_ssl
        self.headers = {
            'Authorization': f'Bearer {secret_key}'
        }
    
    def _get_client(self):
        """Get httpx client with appropriate SSL settings."""
        return httpx.Client(verify=self.verify_ssl)
    
    def list_products(self) -> List[Dict]:
        """List all products in Stripe."""
        with self._get_client() as client:
            response = client.get(
                f"{self.base_url}/products",
                headers=self.headers
            )
            response.raise_for_status()
            return response.json()['data']
    
    def get_product(self, product_id: str) -> Optional[Dict]:
        """Get a product by ID."""
        with self._get_client() as client:
            response = client.get(
                f"{self.base_url}/products/{product_id}",
                headers=self.headers,
                timeout=30.0
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()
    
    def create_product(self, product_id: str, name: str, description: str = "") -> Dict:
        """Create a new product in Stripe."""
        with self._get_client() as client:
            response = client.post(
                f"{self.base_url}/products",
                headers=self.headers,
                data={
                    'id': product_id,
                    'name': name,
                    'description': description
                },
                timeout=30.0
            )
            response.raise_for_status()
            return response.json()
    
    def update_product(self, product_id: str, name: str, description: str = "") -> Dict:
        """Update an existing product in Stripe."""
        with self._get_client() as client:
            response = client.post(
                f"{self.base_url}/products/{product_id}",
                headers=self.headers,
                data={
                    'name': name,
                    'description': description
                },
                timeout=30.0
            )
            response.raise_for_status()
            return response.json()
    
    def list_prices(self, product_id: str = None) -> List[Dict]:
        """List all prices, optionally filtered by product."""
        params = {}
        if product_id:
            params['product'] = product_id
        with self._get_client() as client:
            response = client.get(
                f"{self.base_url}/prices",
                headers=self.headers,
                params=params,
                timeout=30.0
            )
            response.raise_for_status()
            return response.json()['data']
    
    def create_price(self, product_id: str, amount: int, currency: str = "usd", 
                    interval: str = "month", nickname: str = "") -> Dict:
        """Create a new price in Stripe."""
        with self._get_client() as client:
            data = {
                'product': product_id,
                'unit_amount': amount,
                'currency': currency,
                'nickname': nickname
            }
            if interval:
                data['recurring[interval]'] = interval
            response = client.post(
                f"{self.base_url}/prices",
                headers=self.headers,
                data=data,
                timeout=30.0
            )
            response.raise_for_status()
            return response.json()

class BillingConfigurator:
    """Main configurator for Autumn and Stripe."""
    
    def __init__(self, supabase: SupabaseClient, autumn: AutumnClient, 
                 stripe: StripeClient, dry_run: bool = False):
        self.supabase = supabase
        self.autumn = autumn
        self.stripe = stripe
        self.dry_run = dry_run
    
    def configure_autumn(self, plans: List[Dict]) -> Dict[str, str]:
        """Configure Autumn features and plans."""
        results = {}
        
        info("Configuring Autumn...")
        
        try:
            # Ensure CREDITS feature exists
            credits_feature = self.autumn.get_feature('CREDITS')
            if not credits_feature:
                if self.dry_run:
                    warn("DRY RUN: Would create CREDITS feature")
                else:
                    credits_feature = self.autumn.create_feature('CREDITS', 'Credits', 'numeric')
                    success("Created CREDITS feature")
            else:
                success("CREDITS feature already exists")
            
            # Ensure TEAM feature exists
            team_feature = self.autumn.get_feature('TEAM')
            if not team_feature:
                if self.dry_run:
                    warn("DRY RUN: Would create TEAM feature")
                else:
                    team_feature = self.autumn.create_feature('TEAM', 'Team Members', 'numeric')
                    success("Created TEAM feature")
            else:
                success("TEAM feature already exists")
            
            # Configure each plan
            for plan in plans:
                plan_name = plan['name']
                plan_id = plan['id']
                
                info(f"Processing plan: {plan_name}")
                
                max_credits = plan.get('max_credits', 0)
                max_team_members = plan.get('max_team_members', 1)
                auto_enable = (plan_name == 'free')  # Auto-enable free plan
                
                # Create or update plan with items
                existing_plan = self.autumn.get_plan(plan_name)
                if existing_plan:
                    if self.dry_run:
                        warn(f"DRY RUN: Would update Autumn plan for {plan_name}")
                    else:
                        self.autumn.update_plan(plan_name, max_credits, max_team_members)
                        success(f"Updated Autumn plan: {plan_name}")
                else:
                    if self.dry_run:
                        warn(f"DRY RUN: Would create Autumn plan: {plan_name}")
                    else:
                        self.autumn.create_plan(plan_name, f"{plan_name.capitalize()} Plan", max_credits, max_team_members, auto_enable)
                        success(f"Created Autumn plan: {plan_name}")
                
                results[plan_name] = plan_name
        except Exception as e:
            error(f"Failed to configure Autumn: {e}")
            warn("Please configure Autumn manually using the dashboard")
            warn("See docs/AUTUMN_CONFIG_GUIDE.md for manual configuration instructions")
            raise
        
        return results
    
    def configure_stripe(self, plans: List[Dict]) -> Dict[str, Dict]:
        """Configure Stripe products and prices."""
        results = {}
        
        info("Configuring Stripe...")
        
        try:
            # Price mapping for each plan (in cents)
            # These are example prices - should be configurable
            price_mapping = {
                'free': 0,
                'hobby': 2000,      # $20/month
                'standard': 5000,   # $50/month
                'growth': 20000,    # $200/month
                'scale': 50000      # $500/month
            }
            
            for plan in plans:
                plan_name = plan['name']
                plan_id = plan['id']
                
                info(f"Processing plan: {plan_name}")
                
                # Create or update product
                product = self.stripe.get_product(plan_name)
                if not product:
                    if self.dry_run:
                        warn(f"DRY RUN: Would create Stripe product: {plan_name}")
                        product_id = plan_name  # In dry run, use plan name as placeholder
                    else:
                        product = self.stripe.create_product(
                            plan_name,
                            f"{plan_name.capitalize()} Plan",
                            f"Firecrawl {plan_name.capitalize()} subscription plan"
                        )
                        product_id = product['id']
                        success(f"Created Stripe product: {plan_name}")
                else:
                    product_id = product['id']
                    success(f"Stripe product already exists: {plan_name}")
                
                # Create monthly and yearly prices
                monthly_price = price_mapping.get(plan_name, 0)
                yearly_price = monthly_price * 10  # 2 months free for yearly
                
                plan_results = {}
                
                # Monthly price
                existing_prices = []
                if not self.dry_run:
                    existing_prices = self.stripe.list_prices(product_id)
                monthly_price_obj = next(
                    (p for p in existing_prices if p.get('recurring', {}).get('interval') == 'month'),
                    None
                )
                
                if not monthly_price_obj and monthly_price > 0:
                    if self.dry_run:
                        warn(f"DRY RUN: Would create monthly price for {plan_name}")
                    else:
                        monthly_price_obj = self.stripe.create_price(
                            product_id,
                            monthly_price,
                            'usd',
                            'month',
                            f"{plan_name.capitalize()} Monthly"
                        )
                        success(f"Created monthly price for {plan_name}")
                elif monthly_price > 0:
                    success(f"Monthly price already exists for {plan_name}")
                else:
                    info(f"Skipping monthly price for free plan")
                
                plan_results['monthly_price_id'] = monthly_price_obj.get('id') if monthly_price_obj else None
                
                # Yearly price
                yearly_price_obj = next(
                    (p for p in existing_prices if p.get('recurring', {}).get('interval') == 'year'),
                    None
                )
                
                if not yearly_price_obj and yearly_price > 0:
                    if self.dry_run:
                        warn(f"DRY RUN: Would create yearly price for {plan_name}")
                    else:
                        yearly_price_obj = self.stripe.create_price(
                            product_id,
                            yearly_price,
                            'usd',
                            'year',
                            f"{plan_name.capitalize()} Yearly"
                        )
                        success(f"Created yearly price for {plan_name}")
                elif yearly_price > 0:
                    success(f"Yearly price already exists for {plan_name}")
                else:
                    info(f"Skipping yearly price for free plan")
                
                plan_results['yearly_price_id'] = yearly_price_obj.get('id') if yearly_price_obj else None
                
                results[plan_name] = plan_results
        except Exception as e:
            error(f"Failed to configure Stripe: {e}")
            warn("Please configure Stripe manually using the dashboard")
            warn("See docs/AUTUMN_CONFIG_GUIDE.md for manual configuration instructions")
            raise
        
        return results
    
    def run(self, autumn_only: bool = False, stripe_only: bool = False):
        """Run the configuration process."""
        try:
            # Fetch plan configs from Supabase
            info("Fetching plan configs from Supabase...")
            plans = self.supabase.get_plan_configs()
            success(f"Found {len(plans)} plan configs")
            
            for plan in plans:
                info(f"  - {plan['name']}: {plan.get('max_credits', 0)} credits")
            
            if not autumn_only:
                stripe_results = self.configure_stripe(plans)
            
            if not stripe_only:
                autumn_results = self.configure_autumn(plans)
            
            success("\nConfiguration completed successfully!")
            
            if not self.dry_run:
                info("\nNext steps:")
                info("1. Update .env file with Stripe Price IDs")
                info("2. Test subscription flow")
                info("3. Verify Autumn quotas are working")
            
        except Exception as e:
            error(f"Configuration failed: {e}")
            raise

def main():
    parser = argparse.ArgumentParser(
        description='Initialize Autumn and Stripe billing services from Supabase plan_configs'
    )
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done without making changes')
    parser.add_argument('--autumn-only', action='store_true', help='Only configure Autumn')
    parser.add_argument('--stripe-only', action='store_true', help='Only configure Stripe')
    parser.add_argument('--no-verify-ssl', action='store_true', help='Disable SSL certificate verification (useful for proxy/network issues)')
    
    args = parser.parse_args()
    
    # Load environment variables
    load_dotenv()
    
    # Check required environment variables
    required_vars = ['SUPABASE_POSTGRES_HOST', 'SUPABASE_POSTGRES_USER', 'SUPABASE_POSTGRES_PASSWORD']
    if not args.stripe_only:
        required_vars.append('AUTUMN_SECRET_KEY')
    if not args.autumn_only:
        required_vars.append('STRIPE_SECRET_KEY')
    
    missing = [v for v in required_vars if not os.getenv(v)]
    if missing:
        error(f"Missing required environment variables: {', '.join(missing)}")
        sys.exit(1)
    
    # SSL verification setting
    verify_ssl = not args.no_verify_ssl
    if not verify_ssl:
        warn("SSL certificate verification is DISABLED. This may expose you to security risks.")
    
    # Initialize clients
    supabase = SupabaseClient(
        os.getenv('SUPABASE_POSTGRES_HOST'),
        os.getenv('SUPABASE_POSTGRES_USER'),
        os.getenv('SUPABASE_POSTGRES_PASSWORD')
    )
    
    autumn = None
    if not args.stripe_only:
        autumn = AutumnClient(os.getenv('AUTUMN_SECRET_KEY'), verify_ssl=verify_ssl)
    
    stripe = None
    if not args.autumn_only:
        stripe = StripeClient(os.getenv('STRIPE_SECRET_KEY'), verify_ssl=verify_ssl)
    
    try:
        # Run configurator
        configurator = BillingConfigurator(supabase, autumn, stripe, dry_run=args.dry_run)
        configurator.run(autumn_only=args.autumn_only, stripe_only=args.stripe_only)
    finally:
        # Close database connection
        supabase.close()

if __name__ == '__main__':
    main()
