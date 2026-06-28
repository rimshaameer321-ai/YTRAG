# auth.py
# Purpose: Verifies the Supabase JWT token sent by the frontend.
# Every protected route uses get_current_user() as a dependency to confirm
# the request is coming from an authenticated user.
#
# get_supabase_for_user() returns a Supabase client that has the user's
# own token attached, so that Row Level Security (RLS) policies are
# enforced correctly for every database operation (insert/select/delete).
#
# NEW: get_service_supabase() returns a client authenticated with the
# service_role key — full access, bypasses RLS. Used ONLY for backend-
# internal operations that aren't tied to a single request's user, like
# rebuilding the FAISS index from ALL users' document_chunks at startup.

import os
from fastapi import Header, HTTPException
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")  # NEW

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL or SUPABASE_KEY is missing from .env")

if not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is missing from .env")  # NEW

# Base client, used only for verifying tokens (auth.get_user)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# NEW: Single shared service-role client. This bypasses RLS entirely, so it
# must NEVER be exposed to a specific request/user — it's only used for
# internal startup logic (loading all chunks to rebuild FAISS) and for
# writing/deleting chunks alongside the per-user document operations.
_service_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


async def get_current_user(authorization: str = Header(None)):
    """
    Checks the 'Authorization: Bearer <token>' header sent by the frontend.
    Verifies the token against the Supabase Auth server (a real API call,
    not a local decode). Returns the user object if valid, otherwise
    raises a 401 error.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization token missing")

    token = authorization.split(" ")[1]

    try:
        user_response = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if not user_response or not user_response.user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return user_response.user


def get_supabase_for_user(authorization: str = Header(None)) -> Client:
    """
    Returns a Supabase client with the current user's access token attached.
    This ensures every database query (insert/select/delete) is executed
    AS that user, so Supabase's Row Level Security policies are correctly
    enforced — the database itself blocks access to other users' data,
    even if there were a bug in our backend code.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization token missing")

    token = authorization.split(" ")[1]

    user_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    user_client.postgrest.auth(token)
    return user_client


def get_service_supabase() -> Client:
    """
    NEW: Returns the shared service-role Supabase client (bypasses RLS).
    Used by RAGSearch at startup to load every user's document_chunks
    and rebuild the FAISS index in memory — there's no single "current
    user" at that point, so a per-request user token doesn't apply.
    Also used when writing/deleting rows in document_chunks, since that
    table intentionally has no RLS policies (see migration SQL comments).
    """
    return _service_client