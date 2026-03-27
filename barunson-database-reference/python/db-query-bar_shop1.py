#!/usr/bin/env python3
"""bar_shop1 DB 쿼리 실행 스크립트"""
import sys
import os
import pymssql
from dotenv import load_dotenv

load_dotenv()

def main():
    if len(sys.argv) > 1:
        sql = sys.argv[1]
    elif not sys.stdin.isatty():
        sql = sys.stdin.read().strip()
    else:
        print("Usage: python3 db-query-bar_shop1.py \"SQL\"", file=sys.stderr)
        sys.exit(1)

    conn = pymssql.connect(
        server=os.getenv("DB_SERVER"),
        port=int(os.getenv("DB_PORT", "1433")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database="bar_shop1",
    )
    cursor = conn.cursor()
    cursor.execute(sql)

    if cursor.description:
        columns = [col[0] for col in cursor.description]
        print("\t".join(columns))
        print("\t".join("-" * len(c) for c in columns))
        for row in cursor:
            print("\t".join(str(v) if v is not None else "NULL" for v in row))

    conn.close()

if __name__ == "__main__":
    main()
