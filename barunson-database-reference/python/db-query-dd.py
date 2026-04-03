#!/usr/bin/env python3
"""DD (wedding) DB 쿼리 실행 스크립트 - MySQL"""
import sys
import os

try:
    import pymysql
except ImportError:
    print("pymysql 패키지가 필요합니다: pip install pymysql", file=sys.stderr)
    sys.exit(1)

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env-all'))

def main():
    if len(sys.argv) > 1:
        sql = sys.argv[1]
    elif not sys.stdin.isatty():
        sql = sys.stdin.read().strip()
    else:
        print("Usage: python3 db-query-dd.py \"SQL\"", file=sys.stderr)
        sys.exit(1)

    conn = pymysql.connect(
        host=os.getenv("DD_DB_SERVER"),
        port=int(os.getenv("DD_DB_PORT", "3306")),
        user=os.getenv("DD_DB_USER"),
        password=os.getenv("DD_DB_PASSWORD"),
        database="wedding",
        charset="utf8mb4",
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
