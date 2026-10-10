"""Synthetic feeds for two deliberately mismatched banking cores.

Core A = legacy in-house core (CIF numbers, YYYYMMDD dates, product codes, balances in cents,
pipe-delimited extracts). Core B = acquired bank's modern core (UUIDs, ISO dates, JSON lines).
A shared pool of people is split across both with a designed overlap of graded difficulty, and
the ground truth is written to data/truth/ so the entity-resolution step can be scored.
"""
