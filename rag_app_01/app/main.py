"""CLI entry point for the RAG application."""

import sys

from app.graph import build_graph


def main():
    print("Building RAG graph...")
    graph = build_graph()
    print("Ready. Type your questions (Ctrl+C to quit).\n")

    while True:
        try:
            question = input("Question: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye.")
            break

        if not question:
            continue

        print("Thinking...\n")
        result = graph.invoke({"question": question})
        print(f"Answer: {result['answer']}\n")


if __name__ == "__main__":
    main()
