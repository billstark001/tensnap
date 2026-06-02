# TenSnap 绑定与 Schelling mspt 临时讨论

本文是基于当前仓库代码阅读后的临时设计记录，主要涉及：

- Python: `packages/tensnap-python/tensnap/bindings/basic/*`、`utils/attr.py`、`utils/init_hook.py`、`bindings/mesa/*`
- Julia: `packages/tensnap-julia/src/*`、`examples/julia/schelling*.jl`
- JS: `packages/tensnap-js/src/bindings/*`、`examples/js/src/models/schelling.ts`
- Go: `packages/tensnap-go/binding/*`、`packages/tensnap-go/abm/*`、`examples/go/internal/schelling/*`

## 1. Python 绑定装饰器字段：值、函数、字符串与 bool

### 现状

Python layer/item 装饰器的字段规格现在基本是 `str | bool | None`：

- `None`: 自动推断。
- `False`: 跳过该字段。
- `True`: 同名属性映射。
- `str`: 属性路径或类上的 callable 名称。

这会导致 `"float"`、`"circle"`、`"solid"` 这类实际是协议值的字符串被解释成属性路径。因此现在需要写成：

```python
@agent_layer(coord_offset="coord_offset")
class Model:
    coord_offset = "float"
```

这层绕路本质上是“selector”和“literal value”共用一个 Python 类型造成的。

### 建议语义

建议把字段规格拆成四类内部语义：

- `AUTO`: 自动检测字段，兼容现有 `None`。
- `SKIP`: 跳过字段，兼容现有 `False`。
- `SELECTOR`: 从对象上取值，例如属性路径、类方法名、item 类字段名。
- `VALUE`: 常量值或直接 callable。

对用户可见的规则可以先保持简洁：

- `int`、`float`、`Decimal`、NumPy 数字等数字类型：直接作为常量值。
- callable：直接使用。对 metadata 字段调用 `(target) -> value`；对 item 字段调用 `(item) -> value` 或在 dynamic projector 中调用 `(layer, item) -> value`。
- `str`: 默认仍然按 selector 处理，以保证兼容；但按字段维护 literal whitelist。
- `None`: 继续自动检测。
- `False`/`True`: 需要分阶段处理，见下文。

字符串白名单应当是字段级的，而不是全局的。第一批可以从协议 schema 来：

- `coord_offset`: `"int"`, `"float"`
- `interpolation`: `"nearest"`, `"linear"`
- `style`: `"solid"`, `"dashed"`, `"dotted"`
- `icon`: `"arrow"`, `"circle"`, `"square"`, `"triangle"`, `"diamond"`, `"star"`, `"hexagon"`, `"cross"`, `"plus"`, `"pentagon"`，以及 `asset:*`

颜色字符串比较特殊：`"#3498db"` 显然不是安全属性路径，可以自动当作 literal；`"red"` 同时可能是属性名和 CSS color。为了不破坏兼容，建议先不把普通颜色名放入白名单，提供显式 helper：

```python
from tensnap import value, attr

@agent(color=value("red"), icon="circle", x=attr("pos[0]"))
class Agent:
    ...
```

### bool 怎么办

bool 是最容易踩坑的，因为现有 `True`/`False` 已经被用作控制语义，而且 `bool` 在 Python 里是 `int` 的子类。

建议分两步：

1. 短期兼容：
   - `None` 仍是自动检测。
   - `False` 仍是 skip。
   - `True` 在非 boolean schema 字段上仍表示同名 selector。
   - 对 schema 明确是 boolean 的字段，例如 edge `directed`，`True`/`False` 应优先当 literal 值；如果要 skip，用 `SKIP` 或 `skip()`。
   - 需要 boolean 常量但字段不是 boolean schema 时，用 `value(True)`。

2. 长期清理：
   - 新增公开 sentinel/helper：`auto()`, `skip()`, `attr(path)`, `value(v)`。
   - 在文档中标记裸 `True`/`False` 的控制语义为 legacy。
   - 下一个破坏性版本可以让裸 bool 永远表示 literal，控制语义只通过 sentinel 表达。

### 实现落点

- 扩展 `ProjectorFieldForInit`，不要再只等于 `str | bool | None`。
- 把 `_resolve_projector_dict` 从“只返回 attr mapping”改成返回 `field -> FieldSpec`，里面包含 selector、literal、callable。
- `make_attr_projector` 目前已经有 `default_values`，可以承接常量值；但 callable 字段需要一个新的 projector builder，或者在 `BindLayerConfig` 里为含 callable 的字段生成普通闭包。
- 字符串白名单应放在 layer/item schema 附近，而不是散落在每个装饰器里。

## 2. Schelling mspt：哪些能靠 TenSnap 设计继续压低（TenSnap 侧已完成）

当前观察值：

- Python: 20 mspt
- Julia: 11 mspt
- JS: 7 mspt
- Go: 4 mspt

这里要分清模型算法成本和 TenSnap 绑定/同步成本。

本次已完成 TenSnap 侧能压低的部分，未修改 Schelling 模型：

- Python `DefaultSimulationHandler` 的 step 热路径改为 metadata-only environment snapshot + layer item diff，避免先全量构造 items 再在 diff 阶段重复投影；full replay/init/reset 使用已投影 snapshot seed diff cache。
- Python layer binding 增加可选 `item_id_getter` / `item_changed_getter`，配置后只投影新增/变更 item；未配置时仍默认全量列表 diff。
- JS `syncItems` 默认仍接收全量 items，但内部保存 snapshot，只发送实际变化字段；模型已知增量时继续使用 `createItems` / `updateItems` / `deleteItems`。
- Go `binding.AgentLayer` 接入 `abm.ItemDiffTracker`，提供 `ItemID(fn)` / `Changed(fn)` 增量入口；未配置时仍使用 `NaiveItemDiffTracker`。
- Julia `agents_layer(...; item_id, changed)` 增加 declarative 增量源；未配置时 `replace_layer_items!` 仍保持全量 projection + field-level diff。

### Python

Python 还有较大空间，但一部分来自 Mesa 本身：

- Mesa `CellAgent`、`OrthogonalMooreGrid`、`get_neighborhood(...).agents` 的对象遍历成本不是 TenSnap 能直接消掉的。
- `project_agent` 每个 agent 都会调用 `agent.is_satisfied()`，图表里的 `satisfied_pct()` 和 `segregation_index()` 又重新遍历邻居。

TenSnap 设计能压低的部分：

- `DefaultSimulationHandler._push_env_updates()` 先 `environment.build_state()` 构造全量 layer/items，再 `broadcast_env_update()` 里调用 `registration.build_item_deltas()` 重新投影并 diff，等于热路径上至少投影两遍。
- 当前 naive diff 需要每 tick 投影全部 items。可以像 Go 的 `ItemDiffTracker` 那样引入 `id_getter + changed_getter + projector`，只对新增/变更 item 做 projection。
- 可以提供 explicit item update API，让 Schelling 这类模型直接上报 moved/affected agents，而不是每 tick 从完整模型状态反推。
- chart getter 应鼓励模型在 step 内缓存统计值，TenSnap 只读取缓存，避免 chart 广播阶段再次跑邻域计算。

Python 的 20 mspt 里，TenSnap 绑定层能压掉的主要是“双重全量投影 + 全量 diff + 重复 chart 计算”；Mesa 模型本身的邻域遍历需要模型侧优化或专门的 Mesa fast path。

### Julia

Julia 当前 `layers.jl` 的 `_layer_items` 每 tick 把所有 item 变成 `Dict{String,Any}`，`_layer_item_deltas!` 再全量比较。

TenSnap 设计能压低：

- 为 Julia 加 typed diff tracker：`id`, `changed`, `project` 三个函数，未变 item 不投影。
- 支持 manual `create_items! / update_items! / delete_items!` 的同时，给 declarative layer 一个“增量源”接口。
- 避免每个 item 都分配 `Dict{String,Any}`；可在 msgpack/json 发送前最后一刻转换，或提供稳定字段数组/NamedTuple 快路径。
- Schelling 的 `size = a -> satisfied(a, model_ref[]) ? ...` 会每次渲染投影重新算满意度；可以把满意度缓存到 agent 或模型侧状态，再由 projector 读缓存。

Agents.jl 自身的 `nearby_agents`、`empty_positions` 成本不属于 TenSnap 绑定层，但 TenSnap 可以避免把这些计算在 projector/chart 阶段重复触发。

### JS

JS 已经较低，但 `syncItems` 目前只跟踪 ID 集合：已有 item 全部进入 `itemUpdate`，不是 field-level diff。

TenSnap 设计能压低：

- `syncItems` 增加 snapshot diff，只发实际变化字段。
- 提供 `syncChangedItems` 或 `updateItems` 推荐路径，让模型直接传 moved/affected agents。
- 对图表、metadata、items 做一次 tick 内 batch，减少异步 emitter 调用次数。

JS 例子模型本身已经做了 flat grid、empty pool、unsatisfied set 等优化，所以剩余空间主要在同步层而不是算法层。

### Go

Go 目前最快，但绑定层还在 `AgentLayer.PushDiffs()` 里使用 `NaiveItemDiffTracker`，也就是先 `snapshots(target)` 全量投影，再 diff。

TenSnap 设计能压低：

- 把 `abm.ItemDiffTracker` 接入 `binding.AgentLayer`，提供 `ItemID(fn)`, `Changed(fn)` 之类 API。
- `occupiedCells()` 每 tick 分配 slice；可以允许 layer items 迭代器或索引遍历，避免复制 cell 列表。
- tag projector 每 item 产生 `map[string]any`，可以提供固定字段快路径，尤其是 id/x/y/heading/icon/color/size 这种热字段。

Go 的模型算法也还有空间，例如 `SatisfiedPct()`、`SegregationIndex()` 每 tick 遍历全体；但这属于模型统计缓存，不完全是 TenSnap 设计。

### 总结

最值得作为 TenSnap 设计统一抽象的是：

- 每种语言都支持“全量 replay”和“增量 tick”两套路径。
- 增量 tick 支持 `id + changed + project`，避免全量投影。
- projector 不应默认在热路径分配 dict/map。
- chart getter 应偏向读缓存，而不是重新计算模型统计。
- Python handler 不应为了 diff 先构造全量 env state 再构造一遍 item diff。

## 3. Julia 绑定加入 declarative 参数发现和自动 getter/setter

已完成。Julia 侧现在有一个小而明确的函数 API：`parameters_from_fields(...)`
负责生成 getter/setter-backed `Parameter`，`add_parameters!(...)` 负责批量注册。

### 现状

Julia `parameter(...)` 需要显式写：

```julia
parameter("similarity_threshold";
    getter = r -> Agents.abmproperties(r[]).similarity_threshold,
    setter = set_similarity_threshold!,
)
```

这很灵活，但和 Go tags / Python params 相比样板较多。

### 已实现 API

第一层做 field/path 发现：

```julia
add_parameters!(
    scenario,
    parameters_from_fields(model;
        include = [:gridwidth, :gridheight, :similarity_threshold],
        metadata = Dict(
            :gridwidth => (; min = 10, max = 200, step = 1, allow_runtime_change = false),
            :gridheight => (; min = 10, max = 200, step = 1, allow_runtime_change = false),
            :similarity_threshold => (; min = 0, max = 1, step = 0.01, setter = set_similarity_threshold!),
        ),
    ),
)
```

对普通 mutable struct：

- getter: `m -> getproperty(m, field)`
- setter: `(v, m) -> setproperty!(m, field, convert(fieldtype(typeof(m), field), v))`

实际实现会按当前字段值做保守转换：mutable struct 和 `Dict` 会生成 setter；
`NamedTuple` 等只读目标只生成 getter。对 `Dict` / `NamedTuple` / `Ref` /
`Agents.abmproperties(model)` 可以提供 selector：

```julia
parameters_from_fields(model_ref;
    target = r -> Agents.abmproperties(r[]),
    include = [:similarity_threshold],
)
```

### 自动发现规则

- 默认只发现 `Number`, `Bool`, `AbstractString`。
- `Enum` 不从 Julia enum 类型自动推断；用户给 `metadata[field].options` 时生成 `type = "enum"`。
- immutable/read-only 目标只生成 getter，不生成 setter。
- `Ref` 目标通过 `target` 函数间接发现。
- 字段名转 id 可默认 snake/camel 原样保留，也允许 `rename = Dict(:gridwidth => "gridWidth")`。
- metadata 可以覆盖 `getter` / `setter`，用于需要 clamp、重建模型或同步外部状态的字段。
- metadata 可以设置 `allow_runtime_change = false`，用于 gridwidth/gridheight/density/balance 这类只应在下一次 init/reset 生效的结构参数。

### 宏是否必要

不一定要第一版就上宏。闭包 getter/setter 已经足够。如果后续要减少分配或让错误更早暴露，可以加：

```julia
@tensnap_parameters Config begin
    gridwidth id="gridWidth" min=10 max=200 step=1 runtime=false
    similarity_threshold min=0 max=1 step=0.01
end
```

这个宏可以生成 metadata 表和类型稳定 getter/setter，但建议先用普通函数 API 做清楚语义。

## 4. Python kwargs 与类字段重名时的冲突

### 现状问题

`BoundModelReinitializer.register_model()` 现在先 `scenario.add_all(self.model)`，拿到 `model_param_ids` 后，再用这些 id 去排除 reinitializer 的 kwarg 参数。

这个策略有两个隐患：

- 它把“源字段名”和“公开 parameter id”混在一起了。`width` 字段如果公开 id 是 `gridWidth`，就很难判断它是否和构造参数 `width` 冲突。
- `_kwarg_attr_names` 既表示“kwarg 参数由 reinitializer 拥有”，又参与 `current_kwargs()` 的值来源选择。一个字段被移出后，会退回去读 `model.width`；如果注册顺序或 id 映射不一致，就会出现双方都以为对方负责的状态。

### 建议规则

冲突应当按 source name/path 判定，而不是按 parameter id 判定：

- 如果模型字段和构造 kwarg 指向同一个 source name，默认模型字段拥有 UI 参数。
- reinitializer 仍保留这个 kwarg 的构造职责，但它的值来源应绑定到模型字段的 getter，而不是自己再注册一个参数。
- 如果两个 source name 不同但 parameter id 相同，默认报错或显式 `conflict_policy="model" | "kwargs" | "error"`。
- 注册返回值里应明确标记 `owned`, `aliased`, `skipped`，不要静默让路。

### 建议实现

引入一个内部结构：

```python
ParameterSource(
    source_name="width",
    parameter_id="gridWidth",
    owner="model" | "kwargs",
    getter=...,
    setter=...,
)
```

`BoundModelReinitializer` 维护：

- `kwarg_name -> parameter_id`
- `kwarg_name -> value_getter`
- `kwarg_name -> owner`

`current_kwargs()` 不再只看 `_kwarg_attr_names`，而是：

1. 如果 kwarg 由 reinitializer 拥有，读 reinitializer 参数。
2. 如果 kwarg alias 到模型字段，读模型字段 getter。
3. 否则读 constructor default。

这样不会出现“模型参数被保留，但 reinitializer 不知道该从哪里拿构造值”的情况。

## 5. Python 所有 `None` 字段自动检测，以及 `__init__` 动态字段

### 现状

layer/item 的 `None` 自动检测发生在装饰器 attach 时，也就是 class 级别。`_resolve_projector_dict()` 只看默认规则、class attribute 和 annotations。

这无法发现只在 `__init__` 里赋值的字段：

```python
@agent_layer(width=None, height=None)
class Model:
    def __init__(self):
        self.width = 50
        self.height = 50
```

参数发现本身对实例字段有扫描逻辑，但 layer metadata 的自动推断已经在装饰器阶段完成了。

### 类似 datacollector 的做法

`bind_datacollector()` 通过 `install_once_init_hook(..., timing="after")` 在首个实例初始化完成后注入 chart。layer/config 也可以借鉴，但更推荐“lazy finalize”：

1. 装饰器阶段只保存 raw config，不急着生成最终 `LayerBinding`。
2. `binding_api.layer_bindings(instance)` 时，用实例 `vars(instance)`、`dir(instance)`、class annotations、class attrs 一起解析 `None` 字段。
3. 如果只拿到 class，没有实例，则只做 class 级解析；未解析字段保持缺省，不报错。
4. 对于需要在 class 装饰后、实例创建前就可用的场景，可以加一次 `install_once_init_hook`，首个实例创建后刷新 class-level binding cache。

这样比单纯 hook 更稳，因为 monkey patch 到已有实例上的场景也能工作：

```python
agent_layer(width=None, height=None)(Model)
model = Model()
scenario.add_environment(model)  # 此时可以看到 model.width / model.height
```

### 注意点

- binding cache 需要区分 class cache 和 instance-resolved cache。
- 如果不同实例字段形状不同，应该优先按实例解析，不要把第一个实例的结果永久写死到 class。
- `None` 被解析不到时应保持“未设置”，而不是变成 literal `None`；如果用户真想发送 `None`，需要 `value(None)`。

## 6. `@extend` 如何 extend 一个 property

已完成。`extend(cls)` 现在能解析普通函数、`property`、`staticmethod` /
`classmethod` 等 descriptor 的真实名字，并支持显式 `setter=True` /
`deleter=True`。

原来的 `extend(cls)` 只是：

```python
setattr(cls, func.__name__, func)
```

所以它只适合普通函数。property 没有直接的 `__name__`，真实名字在 `property.fget.__name__`。

现在 `extend` 支持 descriptor：

```python
def extend(cls, name=None, *, setter=False, deleter=False):
    def decorator(member):
        attr_name = name or resolve_descriptor_name(member)
        if attr_name is None:
            raise ValueError("extend requires a name for this member")

        installed = member
        if setter:
            installed = getattr(cls, attr_name).setter(member)
        elif deleter:
            installed = getattr(cls, attr_name).deleter(member)

        setattr(cls, attr_name, installed)
        return installed
    return decorator
```

推荐用法：

```python
@extend(Model)
@property
def occupied(self):
    return len(self.agents)

@extend(Model)
@occupied.setter
def occupied(self, value):
    ...
```

也保留显式写法：

```python
@extend(Model, "occupied", setter=True)
def set_occupied(self, value):
    ...
```

这也能支持其他 descriptor，只要能解析出名字。

## 7. 多个 `install_once_init_hook` 装在同一个类上的行为

### 现状

当前每次 `install_once_init_hook` 都会再包一层 `cls.__init__`。多个 hook 叠加时通常能跑，但有几个问题：

- hook 顺序隐含在 wrapper 栈里，不够直观。
- 内层 hook 的 handle 在外层 wrapper 存在时无法真正恢复 `__init__`。
- 多个装饰器都使用 hook 时，类上会形成多层 wrapper，调试和卸载都比较难。
- `before` / `after` 混用时顺序更难解释。

### 已完成优化

已经改成每个 class 只有一个 dispatcher wrapper：

- class 上保存 `_tensnap_init_hook_state`。
- state 里有 `original_init`、`before_hooks`、`after_hooks`、lock 和 dispatcher wrapper。
- 每次 install 只是往列表里加 hook，返回可以从列表移除自己的 handle。
- 首次构造时 dispatcher：
  1. snapshot 当前 hooks。
  2. 恢复 `cls.__init__ = original_init`。
  3. 按注册顺序跑 before hooks。
  4. 调用 original init。
  5. 按注册顺序跑 after hooks。
  6. 清空已消费 hooks。

这样 `bind_kwargs`、`bind_datacollector`、未来的 dynamic field finalize 可以共享同一个 init hook 机制，不再互相包裹。

### 行为建议

- 同一 timing 内按安装顺序执行。
- 如果 before hook 抛错，不调用原始 `__init__`，并消费该批 hooks。
- 如果原始 `__init__` 抛错，after hooks 不执行，但该批 hooks 消费掉，保持现有语义。
- handle 的 `active` 判断应看 state 里该 hook 是否仍存在，而不是比较 `cls.__init__ is wrapper`。
