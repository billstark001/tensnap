"""Tests for parameter bindings and decorators"""

from typing import Annotated

import pytest
from tensnap.bindings.basic import (
    NumberParameter,
    EnumParameter,
    BooleanParameter,
    StringParameter,
    BindParameterConfig,
    BindParametersConfig,
    get_parameter_metadata_from_object,
    get_action_metadata_from_namespace,
    action,
)
from tensnap.models import ActionMetadata
from tensnap.bindings.basic.parameter import create_parameter


class TestParameterClasses:
    """Test parameter dataclass functionality"""

    def test_number_parameter(self):
        """Test NumberParameter creation and serialization"""
        param = NumberParameter(
            id="speed", label="Speed", value=10.0, min=0.0, max=100.0, step=1.0
        )

        assert param.id == "speed"
        assert param.label == "Speed"
        assert param.value == 10.0
        assert param.min == 0.0
        assert param.max == 100.0
        assert param.step == 1.0
        assert param.type == "number"

        # Test serialization
        param_dict = param.to_dict()
        assert param_dict["id"] == "speed"
        assert param_dict["value"] == 10.0
        assert "setter" not in param_dict
        assert "getter" not in param_dict

    def test_enum_parameter(self):
        """Test EnumParameter creation and serialization"""
        param = EnumParameter(
            id="mode",
            label="Mode",
            value="option1",
            options=["option1", "option2", "option3"],
            labels={"option1": "Option 1", "option2": "Option 2"},
        )

        assert param.id == "mode"
        assert param.type == "enum"
        assert param.value == "option1"
        assert param.options == ["option1", "option2", "option3"]
        assert param.labels == {"option1": "Option 1", "option2": "Option 2"}

    def test_boolean_parameter(self):
        """Test BooleanParameter creation"""
        param = BooleanParameter(id="enabled", label="Enabled", value=True)

        assert param.id == "enabled"
        assert param.type == "boolean"
        assert param.value is True

    def test_string_parameter(self):
        """Test StringParameter creation"""
        param = StringParameter(id="name", label="Name", value="test")

        assert param.id == "name"
        assert param.type == "string"
        assert param.value == "test"

    def test_action_metadata(self):
        """Action metadata serializes to the strict v0.3 shape."""
        metadata = ActionMetadata(id="start", label="Start Simulation")

        assert metadata.id == "start"
        assert metadata.label == "Start Simulation"
        assert metadata.continuous is False
        assert metadata.allow_runtime_change is True

        wire = metadata.to_dict()
        assert wire["id"] == "start"
        assert wire["label"] == "Start Simulation"
        assert "continuous" not in wire
        assert "allowRuntimeChange" not in wire
        assert "allow_runtime_change" not in wire

    def test_parameter_label_auto_generation(self):
        """Test automatic label generation from ID"""
        param = NumberParameter(id="max_speed", value=10.0)
        assert param.label == "Max Speed"

        param2 = NumberParameter(id="my_parameter", value=5.0)
        assert param2.label == "My Parameter"

    def test_create_parameter_factory(self):
        """Test create_parameter factory function"""
        # Test number parameter
        num_param = create_parameter(
            id="count", type="number", value=10.0, min=0.0, max=100.0
        )
        assert isinstance(num_param, NumberParameter)
        assert num_param.value == 10.0

        # Test enum parameter
        enum_param = create_parameter(
            id="mode", type="enum", value="fast", options=["fast", "slow"]
        )
        assert isinstance(enum_param, EnumParameter)
        assert enum_param.value == "fast"

        # Test boolean parameter
        bool_param = create_parameter(id="enabled", type="boolean", value=True)
        assert isinstance(bool_param, BooleanParameter)
        assert bool_param.value is True

        # Test string parameter
        str_param = create_parameter(id="name", type="string", value="test")
        assert isinstance(str_param, StringParameter)
        assert str_param.value == "test"


class TestBindDecorator:
    """Test bind decorator functionality"""

    def test_bind_number(self):
        """Test bind decorator for number parameters"""

        class TestModel:
            def __init__(self):
                self._speed = 10.0

            @BindParameterConfig("number", id="speed", min=0.0, max=100.0, step=1.0)
            def get_speed(self):
                return self._speed

        model = TestModel()
        assert model.get_speed == 10.0

        # Check metadata
        bind_obj = TestModel.__dict__["get_speed"]
        assert isinstance(bind_obj, BindParameterConfig)
        assert bind_obj.metadata.id == "speed"
        assert bind_obj.metadata.type == "number"

    def test_bind_boolean(self):
        """Test bind decorator for boolean parameters"""

        class TestModel:
            @BindParameterConfig("boolean", id="enabled", default=True)
            def get_enabled(self):
                return True

        model = TestModel()
        bind_obj = TestModel.__dict__["get_enabled"]
        assert bind_obj.metadata.type == "boolean"

    def test_bind_string(self):
        """Test bind decorator for string parameters"""

        class TestModel:
            @BindParameterConfig("string", id="name", default="test")
            def get_name(self):
                return "test"

        model = TestModel()
        bind_obj = TestModel.__dict__["get_name"]
        assert bind_obj.metadata.type == "string"

    def test_bind_enum(self):
        """Test bind decorator for enum parameters"""

        class TestModel:
            @BindParameterConfig(
                "enum", id="mode", options=["fast", "slow"], default="fast"
            )
            def get_mode(self):
                return "fast"

        model = TestModel()
        bind_obj = TestModel.__dict__["get_mode"]
        assert bind_obj.metadata.type == "enum"
        assert bind_obj.metadata.options == ["fast", "slow"]

    def test_bind_with_setter(self):
        """Test bind decorator with setter"""

        class TestModel:
            def __init__(self):
                self._value = 10.0

            @BindParameterConfig("number", id="model_value", min=0.0, max=100.0)
            def get_value(self):
                return self._value

            def set_value(self, value):
                self._value = value

            get_value = get_value.setter(set_value)

        model = TestModel()
        assert model.get_value == 10.0
        model.get_value = 12.0
        assert model.get_value == 12.0

    def test_bind_dynamic_enum_metadata_from_owner(self):
        """Test descriptor metadata can be resolved from the owning instance."""

        class TestModel:
            def __init__(self):
                self._mode = "fast"
                self.options = ["fast", "slow"]

            @BindParameterConfig(
                "enum",
                id="mode",
                label="Mode",
                options=lambda owner: owner.options,
                labels=lambda owner: {
                    option: option.title() for option in owner.options
                },
            )
            def mode(self):
                return self._mode

            def set_mode(self, value):
                self._mode = value

            mode = mode.setter(set_mode)

        model = TestModel()
        parameters = get_parameter_metadata_from_object(
            model, BindParametersConfig.EXPLICIT_ONLY
        )

        assert len(parameters) == 1
        _, parameter = parameters[0]
        assert parameter.id == "mode"
        assert parameter.value == "fast"
        assert isinstance(parameter, EnumParameter)
        assert parameter.options == ["fast", "slow"]
        assert parameter.labels == {"fast": "Fast", "slow": "Slow"}


class TestBindParametersConfig:
    """Test BindParametersConfig functionality"""

    def test_include_fields(self):
        """Test including specific fields"""
        config = BindParametersConfig(include=["speed", "count"])

        assert config.is_included("speed")
        assert config.is_included("count")
        assert not config.is_included("other")

    def test_exclude_fields(self):
        """Test excluding specific fields"""
        config = BindParametersConfig(exclude=["_private", "internal"])

        assert not config.is_excluded_raw("speed")
        assert config.is_excluded_raw("_private")
        assert config.is_excluded_raw("internal")

    def test_include_regex(self):
        """Test including fields by regex"""
        config = BindParametersConfig(include=r"^param_.*")

        assert config.is_included("param_speed")
        assert config.is_included("param_count")
        assert not config.is_included("speed")

    def test_exclude_regex(self):
        """Test excluding fields by regex"""
        config = BindParametersConfig(exclude=r"^_.*")

        assert config.is_excluded_raw("_private")
        assert config.is_excluded_raw("_internal")
        assert not config.is_excluded_raw("public")

    def test_exclude_all_constant(self):
        """Test the shared exclude-all config."""
        config = BindParametersConfig.EXCLUDE_ALL

        assert not config.is_included("speed")
        assert config.is_excluded_raw("speed")
        assert not config.is_included("_private")

    def test_include_private(self):
        """Test including private fields"""
        config_exclude = BindParametersConfig(include_private=False)
        assert config_exclude.is_included("_private") is False

        config_include = BindParametersConfig(include_private=True)
        assert config_include.is_included("_private") is None

    def test_decorator_usage(self):
        """Test using config as a class decorator"""

        @BindParametersConfig(include=["speed", "count"])
        class TestModel:
            speed = 10.0
            count = 5
            other = "excluded"

        assert hasattr(TestModel, "_tensnap_bind_parameters_config_list")
        config = getattr(TestModel, "_tensnap_bind_parameters_config_list")
        assert config[0].is_included("speed")
        assert config[0].is_included("count")


class TestGetParameterMetadata:
    """Test parameter metadata extraction"""

    def test_get_metadata_from_dict(self):
        """Test extracting metadata from dictionary"""
        namespace = {
            "speed": 10.0,
            "count": 5,
            "name": "test",
            "enabled": True,
        }

        parameters = get_parameter_metadata_from_object(namespace)

        assert len(parameters) == 4
        param_ids = [p[0] for p in parameters]
        assert "speed" in param_ids
        assert "count" in param_ids
        assert "name" in param_ids
        assert "enabled" in param_ids

    def test_get_metadata_from_object(self):
        """Test extracting metadata from object"""

        class TestModel:
            speed = 10.0
            count = 5

        model = TestModel()
        parameters = get_parameter_metadata_from_object(model)

        param_ids = [p[0] for p in parameters]
        assert "speed" in param_ids
        assert "count" in param_ids

    def test_get_metadata_with_bind_decorator(self):
        """Test extracting metadata with bind decorator"""

        class TestModel:
            @BindParameterConfig("number", id="velocity", min=0.0, max=100.0)
            def speed(self):
                return 10.0

        model = TestModel()
        parameters = get_parameter_metadata_from_object(model)

        param_ids = [p[1].id for p in parameters]
        assert "velocity" in param_ids

    def test_get_metadata_with_config(self):
        """Test extracting metadata with configuration"""

        class TestModel:
            speed = 10.0
            count = 5
            _private = "exclude"

        model = TestModel()
        config = BindParametersConfig(exclude=["_private"])
        parameters = get_parameter_metadata_from_object(model, config)

        param_ids = [p[0] for p in parameters]
        assert "_private" not in param_ids

    def test_parameter_type_detection(self):
        """Test automatic parameter type detection"""
        namespace = {
            "speed": 10.5,
            "count": 5,
            "name": "test",
            "enabled": True,
        }

        parameters = get_parameter_metadata_from_object(namespace)

        param_dict = {p[0]: p[1] for p in parameters}
        assert param_dict["speed"].type == "number"
        assert param_dict["count"].type == "number"
        assert param_dict["name"].type == "string"
        assert param_dict["enabled"].type == "boolean"

    def test_init_annotated_parameter_metadata_for_instance_fields(self):
        """Test __init__ Annotated metadata can describe matching instance fields."""

        class TestModel:
            def __init__(
                self,
                speed: Annotated[
                    float,
                    BindParameterConfig(
                        "number", label="Speed", min=0.0, max=10.0, step=0.5
                    ),
                ] = 2.5,
            ):
                self.speed = speed
                self.other = 1

        model = TestModel()
        parameters = get_parameter_metadata_from_object(
            model, BindParametersConfig.EXPLICIT_ONLY
        )

        assert [name for name, _ in parameters] == ["speed"]
        parameter = parameters[0][1]
        assert parameter.label == "Speed"
        assert parameter.value == 2.5
        assert isinstance(parameter, NumberParameter)
        assert parameter.min == 0.0
        assert parameter.max == 10.0
        assert parameter.step == 0.5
