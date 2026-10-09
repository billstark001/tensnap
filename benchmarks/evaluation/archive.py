"""Portable, deterministic tar.gz evidence with a checked file inventory.

Only ordinary files are accepted. Extraction validates every member before any
write and never follows links or permits a path outside the selected directory.
No third-party dependency or shell command is required.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile

INVENTORY = "ARCHIVE_MANIFEST.json"


def digest(stream) -> str:
    value = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        value.update(block)
    return value.hexdigest()


def relative_name(name: str) -> str:
    path = PurePosixPath(name)
    if (
        path.is_absolute()
        or not path.parts
        or path.as_posix() != name
        or any(part in {"..", "."} for part in path.parts)
        or "\\" in name
        or "\x00" in name
    ):
        raise ValueError(f"unsafe archive path: {name}")
    return path.as_posix()


def source_files(root: Path, includes: list[str]) -> list[Path]:
    files: set[Path] = set()
    for name in includes or [""]:
        selected = root / name
        if name:
            relative_name(name)
        if selected.is_symlink():
            raise ValueError(f"symbolic links cannot be archived: {selected}")
        candidates = sorted(selected.rglob("*")) if selected.is_dir() else [selected]
        for candidate in candidates:
            if candidate.is_symlink():
                raise ValueError(f"symbolic links cannot be archived: {candidate}")
            if candidate.is_file():
                files.add(candidate)
    if not files:
        raise ValueError("no evidence files selected")
    return sorted(files, key=lambda file: file.relative_to(root).as_posix())


def create_archive(root: Path, output: Path, includes: list[str]) -> None:
    if output.exists():
        raise FileExistsError(f"refusing to overwrite archive: {output}")
    files = source_files(root, includes)
    if output.resolve() in {file.resolve() for file in files}:
        raise ValueError("archive destination must not be part of its input")
    inventory = []
    for file in files:
        name = file.relative_to(root).as_posix()
        if name == INVENTORY:
            raise ValueError(f"reserved evidence name: {INVENTORY}")
        with file.open("rb") as stream:
            inventory.append(
                {"path": name, "bytes": file.stat().st_size, "sha256": digest(stream)}
            )
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".archive-", dir=output.parent
    ) as temporary:
        stage = Path(temporary) / "evidence.tar.gz"
        with stage.open("wb") as raw, gzip.GzipFile(
            fileobj=raw, mode="wb", filename="", mtime=0, compresslevel=6
        ) as compressed, tarfile.open(
            fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT
        ) as archive:
            for file, entry in zip(files, inventory):
                info = tarfile.TarInfo(entry["path"])
                info.size = entry["bytes"]
                info.mode = 0o644
                with file.open("rb") as stream:
                    archive.addfile(info, stream)
            content = (
                json.dumps({"schemaVersion": 1, "files": inventory}, indent=2) + "\n"
            ).encode()
            info = tarfile.TarInfo(INVENTORY)
            info.size = len(content)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(content))
        verify_archive(stage)
        # Same-filesystem hard link publishes atomically and fails if the destination exists.
        os.link(stage, output)


def checked_members(archive: tarfile.TarFile) -> dict[str, tarfile.TarInfo]:
    members: dict[str, tarfile.TarInfo] = {}
    for member in archive.getmembers():
        name = relative_name(member.name)
        if not member.isfile() or name in members:
            raise ValueError(f"unsupported or duplicate archive member: {name}")
        members[name] = member
    return members


def verify_archive(file: Path) -> dict:
    with tarfile.open(file, "r:gz") as archive:
        members = checked_members(archive)
        inventory = json.load(archive.extractfile(members[INVENTORY]))
        if inventory.get("schemaVersion") != 1:
            raise ValueError("unsupported archive inventory")
        entries = inventory["files"]
        names = [relative_name(entry["path"]) for entry in entries]
        if len(set(names)) != len(names) or set(members) != set(names) | {INVENTORY}:
            raise ValueError("archive members differ from the file inventory")
        for entry in entries:
            member = members[entry["path"]]
            if (
                member.size != entry["bytes"]
                or digest(archive.extractfile(member)) != entry["sha256"]
            ):
                raise ValueError(f"archive checksum mismatch: {entry['path']}")
        return inventory


def extract_archive(file: Path, output: Path) -> None:
    inventory = verify_archive(file)
    if output.exists():
        raise FileExistsError(f"refusing to overwrite extraction directory: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".extract-", dir=output.parent
    ) as temporary:
        stage = Path(temporary) / "evidence"
        stage.mkdir()
        with tarfile.open(file, "r:gz") as archive:
            for entry in inventory["files"]:
                target = stage / entry["path"]
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as destination, archive.extractfile(
                    entry["path"]
                ) as source:
                    for block in iter(lambda: source.read(1024 * 1024), b""):
                        destination.write(block)
        stage.rename(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create")
    create.add_argument("--input", type=Path, required=True)
    create.add_argument("--out", type=Path, required=True)
    create.add_argument("--include", action="append", default=[])
    verify = commands.add_parser("verify")
    verify.add_argument("--input", type=Path, required=True)
    extract = commands.add_parser("extract")
    extract.add_argument("--input", type=Path, required=True)
    extract.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "create":
        create_archive(args.input.resolve(), args.out.resolve(), args.include)
    elif args.command == "verify":
        verify_archive(args.input.resolve())
    else:
        extract_archive(args.input.resolve(), args.out.resolve())
    print(f"Archive {args.command} completed.")


if __name__ == "__main__":
    main()
