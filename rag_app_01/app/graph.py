"""LangGraph RAG pipeline: retrieve context then generate a response."""

from typing import TypedDict

from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_openai import ChatOpenAI
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import StateGraph, START, END

from app.config import CHROMA_DIR, EMBEDDING_MODEL, LLM_BASE_URL, LLM_API_KEY, RETRIEVAL_K


# ── State ────────────────────────────────────────────────────────────────────

class GraphState(TypedDict):
    question: str
    documents: list[Document]
    answer: str


# ── Nodes ────────────────────────────────────────────────────────────────────

def retrieve(state: GraphState) -> dict:
    """Retrieve relevant documents from Chroma."""
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    vector_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        embedding_function=embeddings,
    )
    docs = vector_store.similarity_search(state["question"], k=RETRIEVAL_K)
    return {"documents": docs}


def _build_prompt_and_llm(state: GraphState):
    """Shared setup for generate and generate_stream."""
    llm = ChatOpenAI(
        base_url=LLM_BASE_URL,
        api_key=LLM_API_KEY,
        temperature=0.7,
    )

    context = "\n\n---\n\n".join(doc.page_content for doc in state["documents"])

    prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            "You are a helpful assistant. Answer the user's question using "
            "only the provided context. If the context doesn't contain enough "
            "information, say so.\n\nContext:\n{context}",
        ),
        ("human", "{question}"),
    ])

    return prompt, llm, context


def generate(state: GraphState) -> dict:
    """Generate an answer using the retrieved context and LM Studio."""
    prompt, llm, context = _build_prompt_and_llm(state)
    chain = prompt | llm
    response = chain.invoke({"context": context, "question": state["question"]})
    return {"answer": response.content}


def generate_stream(state: GraphState):
    """Yield answer tokens one at a time for streaming responses."""
    prompt, llm, context = _build_prompt_and_llm(state)
    chain = prompt | llm
    for chunk in chain.stream({"context": context, "question": state["question"]}):
        if chunk.content:
            yield chunk.content


# ── Graph ────────────────────────────────────────────────────────────────────

def build_graph() -> StateGraph:
    """Build and compile the RAG graph."""
    graph = StateGraph(GraphState)

    graph.add_node("retrieve", retrieve)
    graph.add_node("generate", generate)

    graph.add_edge(START, "retrieve")
    graph.add_edge("retrieve", "generate")
    graph.add_edge("generate", END)

    return graph.compile()
