#include <napi.h>
#include <sstream>
#include <string>
#include <vector>

// Simple C++ text analyzer
// Returns an object with word_count
Napi::Object AnalyzeText(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }

  std::string text = info[0].As<Napi::String>().Utf8Value();

  // Manual loop optimization (no sstream needed)
  int count = 0;
  bool inWord = false;

  for (char c : text) {
    if (std::isspace(c)) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("word_count", Napi::Number::New(env, count));
  result.Set("status", "processed_in_cpp_optimized");

  return result;
}

Napi::String Hello(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  return Napi::String::New(
      env, "Hello from ESE C++ Core! High-Performance Module Active.");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "hello"), Napi::Function::New(env, Hello));
  exports.Set(Napi::String::New(env, "analyzeText"),
              Napi::Function::New(env, AnalyzeText));
  return exports;
}

NODE_API_MODULE(ese_core, Init)
