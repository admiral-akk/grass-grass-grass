uniform vec3 pBaseColor;

// Variables described here: https://www.khronos.org/opengl/wiki/Built-in_Variable_(GLSL)
void main()
{
   gl_FragColor = vec4(pBaseColor.rgb, 1.0);
}