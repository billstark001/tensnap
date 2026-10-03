"""Compile a layer's field expressions into one projector.

Inlining is deliberately conservative: a failed proof keeps the original callable.
"""

from __future__ import annotations

import ast
import copy
import dis
import inspect
import linecache
import textwrap
from collections.abc import Callable
from typing import Any, cast


def inline_lambda(  # noqa: PLR0911 - each safety gate has a distinct diagnostic
    value: Callable[..., Any], arguments: tuple[str, ...]
) -> tuple[ast.expr | None, str]:
    """Return a safely substituted lambda body, or a diagnostic reason."""
    if not inspect.isfunction(value) or value.__name__ != "<lambda>":
        return None, "not a Python lambda"
    code = value.__code__
    if code.co_freevars:
        return None, "closure binding requires a live lookup"
    if (
        code.co_argcount != len(arguments)
        or code.co_kwonlyargcount
        or code.co_flags & 0x0C
    ):
        return None, "arguments are not fixed positional parameters"
    if value.__defaults__ or value.__kwdefaults__:
        return None, "default argument binding is not supported"
    try:
        lines, first = inspect.getsourcelines(value)
        raw_source = "".join(lines)
        dedented = textwrap.dedent(raw_source)
        original_line = next(line for line in raw_source.splitlines() if line.strip())
        dedented_line = next(line for line in dedented.splitlines() if line.strip())
        removed_indent = (
            len(original_line)
            - len(original_line.lstrip())
            - len(dedented_line)
            + len(dedented_line.lstrip())
        )
        column_shift = 4 - removed_indent
        tree = ast.parse("def __source__():\n" + textwrap.indent(dedented, "    "))
    except (OSError, IndentationError, SyntaxError, TypeError):
        return None, "source is unavailable"
    candidates = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Lambda)
        and first + node.lineno - 2 == code.co_firstlineno
        and len(node.args.args) == len(arguments)
    ]
    if len(candidates) != 1 and hasattr(code, "co_positions"):
        positions = [
            position
            for instruction in dis.get_instructions(value)
            if (position := getattr(instruction, "positions", None)) is not None
            if instruction.opname not in {"RESUME", "CACHE", "RETURN_VALUE"}
            and position.col_offset is not None
            and position.end_col_offset is not None
        ]
        if positions:
            candidates = [
                candidate
                for candidate in candidates
                if candidate.body.end_col_offset is not None
                and all(
                    position.lineno == first + candidate.body.lineno - 2
                    and candidate.body.col_offset - column_shift <= position.col_offset
                    and position.end_col_offset
                    <= candidate.body.end_col_offset - column_shift
                    for position in positions
                )
            ]
    if len(candidates) != 1:
        return None, "lambda source is ambiguous"
    node = candidates[0]
    if (
        node.args.posonlyargs
        or node.args.vararg
        or node.args.kwarg
        or node.args.kwonlyargs
    ):
        return None, "arguments are not fixed positional parameters"
    forbidden = (
        ast.Lambda,
        ast.ListComp,
        ast.SetComp,
        ast.DictComp,
        ast.GeneratorExp,
        ast.NamedExpr,
        ast.Await,
        ast.Yield,
        ast.YieldFrom,
    )
    if any(isinstance(child, forbidden) for child in ast.walk(node.body)):
        return None, "expression has an inner scope or assignment"
    parameters = [arg.arg for arg in node.args.args]
    # External names may be rebound in globals or builtins. Preserve their
    # original lookup by calling the lambda until live bindings are supported.
    if any(
        isinstance(child, ast.Name) and child.id not in parameters
        for child in ast.walk(node.body)
    ):
        return None, "expression reads an external name"

    replacements = dict(zip(parameters, arguments, strict=True))

    class Replace(ast.NodeTransformer):
        def visit_Name(self, name: ast.Name) -> ast.Name:
            if name.id in replacements:
                return ast.copy_location(
                    ast.Name(id=replacements[name.id], ctx=name.ctx), name
                )
            return name

    return Replace().visit(copy.deepcopy(node.body)), "inlined"


class ProjectionPlan:
    """An ordered collection of direct expressions and callable fallbacks."""

    def __init__(self, arguments: tuple[str, ...]) -> None:
        self.arguments = arguments
        self.locals: dict[str, ast.expr] = {}
        self.fields: dict[str, ast.expr] = {}
        self.environment: dict[str, Any] = {}
        self.diagnostics: dict[str, str] = {}

    def expression(self, field: str, expression: ast.expr) -> None:
        self.fields[field] = expression

    def local(self, name: str, expression: ast.expr) -> None:
        self.locals[name] = expression

    def literal(self, field: str, value: Any) -> None:
        name = f"__ts_value_{len(self.environment)}"
        self.environment[name] = value
        self.expression(field, ast.Name(id=name, ctx=ast.Load()))

    def callable(
        self,
        field: str,
        value: Callable[..., Any],
        *,
        call_arguments: tuple[str, ...] | None = None,
    ) -> None:
        args = self.arguments if call_arguments is None else call_arguments
        expression, reason = inline_lambda(value, args)
        self.diagnostics[field] = reason
        if expression is not None:
            self.expression(field, expression)
            return
        name = f"__ts_callable_{len(self.environment)}"
        self.environment[name] = value
        self.expression(
            field,
            ast.Call(
                func=ast.Name(id=name, ctx=ast.Load()),
                args=[ast.Name(id=arg, ctx=ast.Load()) for arg in args],
                keywords=[],
            ),
        )

    def compile(self) -> Callable[..., dict[str, Any]]:
        dictionary = ast.Dict(
            keys=[ast.Constant(field) for field in self.fields],
            values=list(self.fields.values()),
        )
        arguments = ast.arguments(
            posonlyargs=[],
            args=[ast.arg(arg=arg) for arg in self.arguments],
            vararg=None,
            kwonlyargs=[],
            kw_defaults=[],
            kwarg=None,
            defaults=[],
        )
        read_names = {
            node.id
            for expression in self.fields.values()
            for node in ast.walk(expression)
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
        }
        assignments = [
            ast.Assign(targets=[ast.Name(id=name, ctx=ast.Store())], value=value)
            for name, value in self.locals.items()
            if name in read_names
        ]
        module = ast.fix_missing_locations(
            ast.Module(
                body=[
                    ast.FunctionDef(
                        name="project",
                        args=arguments,
                        body=[*assignments, ast.Return(value=dictionary)],
                        decorator_list=[],
                        returns=None,
                        type_comment=None,
                    )
                ],
                type_ignores=[],
            )
        )
        filename = f"<tensnap projection {id(self)}>"
        source = ast.unparse(module) + "\n"
        linecache.cache[filename] = (
            len(source),
            None,
            source.splitlines(keepends=True),
            filename,
        )
        namespace = dict(self.environment)
        exec(compile(module, filename, "exec"), namespace)
        result = namespace["project"]
        setattr(result, "inline_diagnostics", dict(self.diagnostics))  # noqa: B010
        return cast(Callable[..., dict[str, Any]], result)


def path_expression(root: str, path: str) -> ast.expr:
    """Parse a previously validated attribute/index path once."""
    return ast.parse(f"{root}.{path}", mode="eval").body
