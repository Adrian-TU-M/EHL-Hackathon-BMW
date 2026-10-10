import argparse
from pathlib import Path

from .sources import load_catalog


def main():
    parser = argparse.ArgumentParser(
        description="Privately inventory the supplied BMW source collection"
    )
    parser.add_argument(
        "--input-dir", type=Path, default=Path("../private-data/inputs")
    )
    parser.add_argument(
        "--catalog-dir", type=Path, default=Path("../private-data/catalogs")
    )
    args = parser.parse_args()
    catalog = load_catalog(args.input_dir, args.catalog_dir)
    print(
        f"Snapshot {catalog.snapshot_hash}: {len(catalog.sources)} sources, {len(catalog.evidence)} evidence records"
    )
    for s in catalog.sources:
        print(s.id, s.coverage)


if __name__ == "__main__":
    main()
