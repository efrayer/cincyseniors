#!/usr/bin/env python3
"""
Enrich Cincinnati Senior Services Directory entries in ChromaDB.

Reads directory_enrichments.json, finds matching existing entries by org name,
deletes the sparse version, and replaces with an enriched entry that includes
full address, phone, and website — all with type: "directory_entry" metadata
so the keyword boost in the RAG picks them up correctly.

Usage:
    source venv/bin/activate
    python3 enrich_directory.py [--dry-run]
"""

import json
import sys
import re
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document

CHROMA_DIR = "chroma_store"
COLLECTION = "cincyseniors"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
ENRICHMENTS_FILE = "directory_enrichments.json"

DRY_RUN = "--dry-run" in sys.argv


def load_store():
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    return Chroma(
        persist_directory=CHROMA_DIR,
        collection_name=COLLECTION,
        embedding_function=embeddings,
    )


def find_existing(store, org_name: str):
    """Return list of (doc_id, content) tuples matching org name."""
    data = store._collection.get()
    matches = []
    name_lower = org_name.lower()
    for doc_id, meta, content in zip(data["ids"], data["metadatas"], data["documents"]):
        if meta.get("type") == "directory_entry":
            first_line = content.split("\n")[0]
            # Extract org name portion after "Organization: "
            existing_name = first_line.replace("Organization: ", "")
            if name_lower in existing_name.lower() or existing_name.lower() in name_lower:
                matches.append((doc_id, content))
    return matches


def build_entry_text(entry: dict) -> str:
    """Build the canonical directory entry text from an enrichment record."""
    name = entry["name"].strip()
    address = entry.get("address", "").strip()
    city_state_zip = entry.get("city_state_zip", "").strip()
    county = entry.get("county", "").strip()
    org_type = entry.get("type", "").strip()
    phone = entry.get("phone", "").strip()
    website = entry.get("website", "").strip()

    # Build location string
    if address:
        location = f"{address}, {city_state_zip} {county}".strip()
    else:
        location = f"{city_state_zip} {county}".strip()

    lines = [
        f"Organization: {name} {location}",
        f"Type: {org_type}",
    ]
    if phone:
        lines.append(f"Phone: {phone}")
    if website:
        lines.append(f"Website: {website}")
    lines.append("Source: Greater Cincinnati Senior Services Directory")

    return "\n".join(lines)


def has_useful_data(entry: dict) -> bool:
    """Return True if the entry has at least an address or website to add."""
    return bool(entry.get("address", "").strip() or entry.get("website", "").strip() or entry.get("phone", "").strip())


def main():
    with open(ENRICHMENTS_FILE) as f:
        enrichments = json.load(f)

    store = load_store()

    skipped = 0
    enriched = 0
    not_found = 0

    for entry in enrichments:
        org_name = entry["name"]

        if not has_useful_data(entry):
            print(f"  SKIP (no new data): {org_name}")
            skipped += 1
            continue

        matches = find_existing(store, org_name)
        if not matches:
            print(f"  NOT FOUND in DB: {org_name}")
            not_found += 1
            continue

        new_text = build_entry_text(entry)
        print(f"\n  ENRICHING: {org_name}")
        print(f"    New text preview: {new_text[:120]}")

        if not DRY_RUN:
            # Delete old entries
            for doc_id, old_content in matches:
                store._collection.delete(ids=[doc_id])
                print(f"    Deleted old entry (id={doc_id[:8]}...)")

            # Add enriched entry
            doc = Document(
                page_content=new_text,
                metadata={
                    "type": "directory_entry",
                    "source": "cincinnati_senior_directory_enriched",
                },
            )
            store.add_documents([doc])
            print(f"    Added enriched entry.")
        else:
            print(f"    [DRY RUN — no changes made]")

        enriched += 1

    print(f"\n{'='*50}")
    print(f"Done.  Enriched: {enriched}  Skipped (no data): {skipped}  Not found: {not_found}")
    if DRY_RUN:
        print("DRY RUN — no changes were made to ChromaDB.")


if __name__ == "__main__":
    main()
