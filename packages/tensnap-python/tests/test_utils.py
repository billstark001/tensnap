from tensnap.utils.init_hook import install_once_init_hook
from tensnap.utils.object import extend


def test_extend_installs_property_and_property_setter_descriptor():
    class Model:
        def __init__(self):
            self.agents = [1, 2]
            self.requested_occupied = None

    @extend(Model)
    @property
    def occupied(self):
        return len(self.agents)

    model = Model()
    assert model.occupied == 2  # type: ignore

    @extend(Model)
    @occupied.setter
    def occupied(self, value):
        self.requested_occupied = value

    model.occupied = 5  # type: ignore
    assert model.requested_occupied == 5
    assert isinstance(Model.occupied, property)  # type: ignore


def test_extend_installs_explicit_property_setter_by_name():
    class Model:
        def __init__(self):
            self._value = 1

    @extend(Model)
    @property
    def value(self):
        return self._value

    @extend(Model, "value", setter=True)
    def set_value(self, next_value):
        self._value = next_value

    model = Model()
    model.value = 3  # type: ignore
    assert model.value == 3  # type: ignore


def test_multiple_once_init_hooks_share_one_dispatcher_in_install_order():
    events = []

    class Model:
        def __init__(self, label):
            events.append(("init", label))
            self.label = label

    original_init = Model.__init__
    first = install_once_init_hook(
        Model,
        lambda _instance, args, _kwargs: events.append(("before-1", args[0])),
        timing="before",
    )
    second = install_once_init_hook(
        Model,
        lambda _instance, args, _kwargs: events.append(("before-2", args[0])),
        timing="before",
    )
    third = install_once_init_hook(
        Model,
        lambda instance, _args, _kwargs: events.append(("after-1", instance.label)),
        timing="after",
    )
    fourth = install_once_init_hook(
        Model,
        lambda instance, _args, _kwargs: events.append(("after-2", instance.label)),
        timing="after",
    )

    assert first.active
    assert second.active
    assert third.active
    assert fourth.active

    model = Model("ready")

    assert model.label == "ready"
    assert events == [
        ("before-1", "ready"),
        ("before-2", "ready"),
        ("init", "ready"),
        ("after-1", "ready"),
        ("after-2", "ready"),
    ]
    assert Model.__init__ is original_init
    assert not first.active
    assert not second.active
    assert not third.active
    assert not fourth.active


def test_uninstall_one_once_init_hook_keeps_other_hooks_active():
    events = []

    class Model:
        def __init__(self):
            events.append("init")

    before = install_once_init_hook(
        Model,
        lambda _instance, _args, _kwargs: events.append("before"),
        timing="before",
    )
    after = install_once_init_hook(
        Model,
        lambda _instance, _args, _kwargs: events.append("after"),
        timing="after",
    )

    before.uninstall()

    assert not before.active
    assert after.active

    Model()

    assert events == ["init", "after"]
    assert not after.active
